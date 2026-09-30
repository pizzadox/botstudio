import { db } from '@/lib/db';
import { processInbound } from '@/lib/webhook';
import { claimInboundKey } from '@/lib/inbound-dedupe';
import {
  maxAnswerCallback,
  maxDeleteSubscription,
  maxGetMe,
  maxGetUpdates,
  maxListSubscriptions,
  maxSendMessage,
  type MaxUpdate,
} from '@/lib/max-api';

/**
 * Фоновый приёмщик сообщений MAX (Long Polling, GET /updates).
 *
 * Запускается один раз на процесс сервера (см. src/instrumentation.ts).
 * Для каждого активного MAX-канала с токеном держит собственный цикл
 * опроса. Список каналов синхронизируется каждые 5 секунд — новые каналы
 * подхватываются автоматически, удалённые/выключенные останавливаются.
 *
 * Вебхук настраивать не нужно: токена достаточно. При старте цикла мы
 * отписываем бот от всех вебхуков — иначе MAX будет доставлять события
 * дважды (подписка + long polling) и сообщения задвоятся.
 */

const SYNC_INTERVAL_MS = 5000;
const LONG_POLL_SEC = 25;
/** Не отвечаем на сообщения старше 2 минут (например, накопившиеся до подключения канала). */
const STALE_MS = 2 * 60 * 1000;

interface ChannelLoop {
  stopped: boolean;
  marker?: number;
  botUserId?: number;
  webhooksCleared?: boolean;
}

interface PollerGlobal {
  started: boolean;
  loops: Map<string, ChannelLoop>;
}

const g = globalThis as unknown as { __maxPoller?: PollerGlobal };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function startMaxPoller(): void {
  if (g.__maxPoller?.started) return;
  g.__maxPoller = { started: true, loops: new Map() };
  console.log('[max-poller] запущен');
  void syncLoop();
}

/** Главный цикл: синхронизирует набор каналов с циклами опроса. */
async function syncLoop(): Promise<void> {
  for (;;) {
    try {
      const channels = await db.channel.findMany({
        where: { type: 'max', active: true, token: { not: null } },
        select: { id: true },
      });
      const loops = g.__maxPoller?.loops;
      if (loops) {
        for (const [id, loop] of loops) {
          if (!channels.some((c) => c.id === id)) {
            loop.stopped = true;
            loops.delete(id);
            console.log('[max-poller] канал остановлен:', id);
          }
        }
        for (const ch of channels) {
          if (!loops.has(ch.id)) {
            const loop: ChannelLoop = { stopped: false };
            loops.set(ch.id, loop);
            void channelLoop(ch.id, loop);
          }
        }
      }
    } catch (e) {
      console.error('[max-poller] ошибка синхронизации каналов:', e);
    }
    await sleep(SYNC_INTERVAL_MS);
  }
}

/** Цикл Long Polling для одного канала. */
async function channelLoop(channelId: string, loop: ChannelLoop): Promise<void> {
  console.log('[max-poller] канал запущен:', channelId);
  let errorCount = 0;
  /** Токен, для которого актуален marker (при смене токена маркер сбрасывается) */
  let markerToken: string | null = null;

  while (!loop.stopped) {
    let token: string | null = null;
    try {
      const ch = await db.channel.findUnique({ where: { id: channelId } });
      if (!ch || !ch.active || ch.type !== 'max' || !ch.token) break;
      token = ch.token;

      if (token !== markerToken) {
        // Токен сменился (или это первый запуск) — начинаем с чистого маркера
        markerToken = token;
        loop.marker = undefined;
        loop.botUserId = undefined;
        loop.webhooksCleared = false;
      }

      // Один раз узнаём user_id бота, чтобы игнорировать собственные сообщения
      if (loop.botUserId === undefined) {
        const me = await maxGetMe(token);
        loop.botUserId = me.ok ? me.bot.user_id : -1;
      }

      // Гарантия одиночной доставки: если у бота есть вебхук-подписки —
      // отписываемся, иначе MAX пришлёт каждое событие дважды.
      if (!loop.webhooksCleared) {
        const subs = await maxListSubscriptions(token);
        for (const url of subs.urls) {
          const removed = await maxDeleteSubscription(token, url);
          console.log('[max-poller] отписан вебхук', url, removed ? '(успешно)' : '(не удалось)');
        }
        loop.webhooksCleared = true;
      }

      const res = await maxGetUpdates(token, loop.marker, LONG_POLL_SEC);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          // Токен отклонён: ждём внутри цикла (не завершая его) — если
          // пользователь заменит токен, подхватим его автоматически.
          await db.channel
            .update({ where: { id: channelId }, data: { lastStatus: 'Ошибка: MAX отклонил токен' } })
            .catch(() => {});
          console.warn('[max-poller] канал', channelId, '— токен отклонён, повтор через 30с');
          await sleep(30000);
          continue;
        }
        errorCount += 1;
        if (errorCount <= 3 || errorCount % 20 === 0) {
          console.error('[max-poller] канал', channelId, '—', res.error);
        }
        await sleep(5000);
        continue;
      }

      errorCount = 0;

      if (loop.marker === undefined) {
        // Первый успешный опрос: запоминаем маркер. Последнее «висящее»
        // обновление обрабатываем только если оно свежее (дублей не будет:
        // processInbound дедуплицирует по mid/callback_id).
        loop.marker = res.marker;
        const fresh = res.updates.filter((u) => (u.timestamp ?? 0) > Date.now() - STALE_MS);
        for (const upd of fresh) {
          await handleUpdate(channelId, token, loop, upd);
        }
        await markConnected(channelId);
        continue;
      }

      loop.marker = res.marker ?? loop.marker;
      for (const upd of res.updates) {
        await handleUpdate(channelId, token, loop, upd);
      }
    } catch (e) {
      console.error('[max-poller] канал', channelId, '— непредвиденная ошибка:', e);
      await sleep(5000);
    }
  }

  loop.stopped = true;
  g.__maxPoller?.loops.delete(channelId);
  console.log('[max-poller] канал завершён:', channelId);
}

async function markConnected(channelId: string): Promise<void> {
  await db.channel
    .update({ where: { id: channelId }, data: { lastStatus: 'OK: получаю сообщения из MAX' } })
    .catch(() => {});
}

async function handleUpdate(channelId: string, token: string, loop: ChannelLoop, upd: MaxUpdate): Promise<void> {
  if (upd?.update_type === 'message_created') {
    await handleMessageCreated(channelId, token, loop, upd);
    return;
  }
  if (upd?.update_type === 'message_callback') {
    await handleMessageCallback(channelId, token, loop, upd);
  }
}

/** Обычное текстовое сообщение от пользователя. */
async function handleMessageCreated(
  channelId: string,
  token: string,
  loop: ChannelLoop,
  upd: MaxUpdate
): Promise<void> {
  const msg = upd.payload?.message ?? upd.message;
  if (!msg) return;

  const sender = msg.sender ?? {};
  if (sender.is_bot === true || (loop.botUserId !== undefined && sender.user_id === loop.botUserId)) return;

  const text = String(msg.body?.text ?? '').trim();
  if (!text) return; // сообщения только с вложениями не обрабатываем

  const chatId = String(msg.recipient?.chat_id ?? sender.user_id ?? '');
  if (!chatId) return;

  // Защита от дублей: MAX может доставить сообщение и через long polling,
  // и через вебхук, плюс ретраи после таймаутов
  const mid = msg.body?.mid;
  if (mid && !claimInboundKey(`${channelId}:${mid}`)) return;

  const contact = sender.name ?? sender.first_name ?? sender.username ?? undefined;

  const result = await processInbound(channelId, {
    externalId: chatId,
    text: text.slice(0, 2000),
    contact,
    externalKey: mid,
  });

  if (!result.ok) {
    if (result.error === 'bot_not_published') {
      await db.channel
        .update({ where: { id: channelId }, data: { lastStatus: 'Опубликуйте бота в конструкторе' } })
        .catch(() => {});
    }
    console.warn('[max-poller] сообщение пропущено:', result.error);
    return;
  }
  if (result.duplicate) return; // уже отвечали на это сообщение

  await sendReplies(token, chatId, result.messages);
}

/** Нажатие inline-кнопки: трактуем payload как текст выбора пользователя. */
async function handleMessageCallback(
  channelId: string,
  token: string,
  loop: ChannelLoop,
  upd: MaxUpdate
): Promise<void> {
  const cb = upd.payload?.callback ?? upd.callback;
  if (!cb) return;

  const callbackId = cb.callback_id ?? '';
  const choice = String(cb.button?.text ?? cb.payload ?? '').trim();
  if (!choice) {
    if (callbackId) await maxAnswerCallback(token, callbackId).catch(() => {});
    return;
  }

  const chatId = String(
    cb.message?.recipient?.chat_id ?? cb.user?.user_id ?? loop.botUserId ?? ''
  );
  if (!chatId) return;

  if (callbackId && !claimInboundKey(`${channelId}:cb:${callbackId}`)) return;

  const contact = cb.user?.name ?? cb.user?.first_name ?? cb.user?.username ?? undefined;

  const result = await processInbound(channelId, {
    externalId: chatId,
    text: choice.slice(0, 2000),
    contact,
    externalKey: callbackId ? `cb:${callbackId}` : undefined,
  });

  if (!result.ok || result.duplicate) {
    // Снимаем «крутилку» с кнопки в любом случае
    if (callbackId) await maxAnswerCallback(token, callbackId).catch(() => {});
    if (!result.ok) console.warn('[max-poller] callback пропущен:', result.error);
    return;
  }

  // Первый ответ отправляем как ответ на callback (мгновенно, без крутилки),
  // остальные — обычными сообщениями
  const [first, ...rest] = result.messages;
  if (callbackId) {
    await maxAnswerCallback(token, callbackId, first?.text, first?.buttons);
  } else if (first) {
    await maxSendMessage(token, chatId, first.text, first.buttons);
  }
  let sent = 1;
  for (const m of rest) {
    if (sent > 0) await sleep(650); // лимит MAX: 2 сообщения/сек на диалог
    await maxSendMessage(token, chatId, m.text, m.buttons);
    sent += 1;
  }
}

async function sendReplies(
  token: string,
  chatId: string,
  messages: { text: string; buttons?: { id: string; text: string }[] }[]
): Promise<void> {
  let sent = 0;
  for (const m of messages) {
    if (sent > 0) await sleep(650); // лимит MAX: 2 сообщения/сек на диалог
    const res = await maxSendMessage(token, chatId, m.text, m.buttons);
    if (!res.ok) {
      console.error('[max-poller] не удалось отправить ответ:', res.error);
      break;
    }
    sent += 1;
  }
}

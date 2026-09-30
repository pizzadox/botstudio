import { db } from '@/lib/db';
import { processInbound } from '@/lib/webhook';
import { maxGetMe, maxGetUpdates, maxSendText, type MaxUpdate } from '@/lib/max-api';

/**
 * Фоновый приёмщик сообщений MAX (Long Polling, GET /updates).
 *
 * Запускается один раз на процесс сервера (см. src/instrumentation.ts).
 * Для каждого активного MAX-канала с токеном держит собственный цикл
 * опроса. Список каналов синхронизируется каждые 5 секунд — новые каналы
 * подхватываются автоматически, удалённые/выключенные останавливаются.
 *
 * Вебхук настраивать не нужно: токена достаточно.
 */

const SYNC_INTERVAL_MS = 5000;
const LONG_POLL_SEC = 25;
/** Не отвечаем на сообщения старше 2 минут (например, накопившиеся до подключения канала). */
const STALE_MS = 2 * 60 * 1000;

interface ChannelLoop {
  stopped: boolean;
  marker?: number;
  botUserId?: number;
  connectedAt: number;
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
            const loop: ChannelLoop = { stopped: false, connectedAt: 0 };
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
      }

      // Один раз узнаём user_id бота, чтобы игнорировать собственные сообщения
      if (loop.botUserId === undefined) {
        const me = await maxGetMe(token);
        loop.botUserId = me.ok ? me.bot.user_id : -1;
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
        // обновление обрабатываем только если оно свежее.
        loop.marker = res.marker;
        const fresh = res.updates.filter((u) => (u.timestamp ?? 0) > Date.now() - STALE_MS);
        for (const upd of fresh) {
          await handleUpdate(channelId, token, loop, upd);
        }
        loop.connectedAt = Date.now();
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
  if (upd?.update_type !== 'message_created') return;
  const msg = upd.payload?.message ?? upd.message;
  if (!msg) return;

  const sender = msg.sender ?? {};
  if (sender.is_bot === true || (loop.botUserId !== undefined && sender.user_id === loop.botUserId)) return;

  const text = String(msg.body?.text ?? '').trim();
  if (!text) return; // сообщения только с вложениями не обрабатываем

  const chatId = String(msg.recipient?.chat_id ?? sender.user_id ?? '');
  if (!chatId) return;

  const contact = sender.name ?? sender.first_name ?? sender.username ?? undefined;

  const result = await processInbound(channelId, {
    externalId: chatId,
    text: text.slice(0, 2000),
    contact,
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

  // Лимит MAX: не более 2 сообщений в секунду на диалог
  let sent = 0;
  for (const reply of result.replies) {
    if (sent > 0) await sleep(650);
    const sentRes = await maxSendText(token, chatId, reply);
    if (!sentRes.ok) {
      console.error('[max-poller] не удалось отправить ответ:', sentRes.error);
      break;
    }
    sent += 1;
  }
}

import { db } from '@/lib/db';
import { handleMaxUpdate } from '@/lib/max-inbound';
import {
  maxDeleteSubscription,
  maxGetMe,
  maxGetUpdates,
  maxListSubscriptions,
  type MaxUpdate,
} from '@/lib/max-api';

/**
 * Фоновый приёмник сообщений MAX (Long Polling, GET /updates).
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

/** BE22-05: экспоненциальный backoff: delay = min(5000 * 2^n, cap).
 *  cap 120000 (2 мин) — сетевые сбои/5xx; cap 300000 (5 мин) — 401/403. */
function backoffDelay(attempt: number, capMs: number): number {
  const n = Math.max(attempt - 1, 0);
  return Math.min(5000 * 2 ** n, capMs);
}

interface ChannelLoop {
  stopped: boolean;
  marker?: number;
  botUserId?: number;
  webhooksCleared?: boolean;
  /** BE22-15: если getMe не удался — сколько циклов пропустить до повторной попытки
   *  (не кэшируем «-1»: токен мог быть заменён, нужно получить реальный user_id). */
  meRetryIn?: number;
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
  /** Счётчик сетевых сбоев/5xx подряд (сбрасывается успехом) */
  let errorCount = 0;
  /** Счётчик отказов авторизации подряд (BE22-05: до 5 минут) */
  let authErrorCount = 0;
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
        loop.meRetryIn = undefined;
      }

      // Один раз узнаём user_id бота, чтобы игнорировать собственные сообщения.
      // BE22-15: при неудаче НЕ кэшируем «-1» навсегда — пробуем раз в 30 циклов,
      // пока getMe не ответит (например, токен только что создан/заменён).
      if (loop.botUserId === undefined) {
        if ((loop.meRetryIn ?? 0) > 0) {
          loop.meRetryIn = (loop.meRetryIn ?? 0) - 1;
        } else {
          const me = await maxGetMe(token);
          if (me.ok) {
            loop.botUserId = me.bot.user_id;
            loop.meRetryIn = undefined;
          } else {
            loop.meRetryIn = 30;
            console.warn(
              '[max-poller] канал',
              channelId,
              '— getMe не удался, повтор через 30 циклов:',
              me.error
            );
          }
        }
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
          // BE22-05: экспоненциальный backoff до 5 минут, чтобы не долбить API.
          authErrorCount += 1;
          const delay = backoffDelay(authErrorCount, 300000);
          await db.channel
            .update({ where: { id: channelId }, data: { lastStatus: 'Ошибка: MAX отклонил токен' } })
            .catch(() => {});
          if (authErrorCount <= 3 || authErrorCount % 10 === 0) {
            console.warn(
              '[max-poller] канал',
              channelId,
              '— токен отклонён, повтор через',
              Math.round(delay / 1000),
              'с'
            );
          }
          await sleep(delay);
          continue;
        }
        // Сетевой сбой/5xx: экспоненциальный backoff до 2 минут (BE22-05)
        errorCount += 1;
        const delay = backoffDelay(errorCount, 120000);
        if (errorCount <= 3 || errorCount % 20 === 0) {
          console.error(
            '[max-poller] канал',
            channelId,
            '—',
            res.error,
            `| повтор через ${Math.round(delay / 1000)}с`
          );
        }
        await sleep(delay);
        continue;
      }

      errorCount = 0;
      authErrorCount = 0;

      if (loop.marker === undefined) {
        // Первый успешный опрос: запоминаем маркер. Последнее «висящее»
        // обновление обрабатываем только если оно свежее (дублей не будет:
        // processInbound дедуплицирует по mid/callback_id).
        loop.marker = res.marker;
        const fresh = res.updates.filter((u) => (u.timestamp ?? 0) > Date.now() - STALE_MS);
        await handleUpdatesSafely(channelId, token, fresh, loop.botUserId);
        await markConnected(channelId);
        continue;
      }

      // Маркер продвигаем ДО обработки: падение одного апдейта (BE22-01в)
      // не остановит батч и не приведёт к повторной обработке остальных.
      loop.marker = res.marker ?? loop.marker;
      await handleUpdatesSafely(channelId, token, res.updates, loop.botUserId);
    } catch (e) {
      // BE22-05: непредвиденная ошибка тоже с экспоненциальным backoff
      errorCount += 1;
      const delay = backoffDelay(errorCount, 120000);
      console.error(
        '[max-poller] канал',
        channelId,
        '— непредвиденная ошибка:',
        e,
        `| повтор через ${Math.round(delay / 1000)}с`
      );
      await sleep(delay);
    }
  }

  loop.stopped = true;
  g.__maxPoller?.loops.delete(channelId);
  console.log('[max-poller] канал завершён:', channelId);
}

/**
 * BE22-01в: каждый апдейт обрабатывается в собственном try/catch —
 * падение одного сообщения/кнопки не убивает весь батч и не влияет
 * на продвижение маркера (он уже выставлен вызывающим кодом).
 */
async function handleUpdatesSafely(
  channelId: string,
  token: string,
  updates: MaxUpdate[],
  botUserId?: number
): Promise<void> {
  for (const upd of updates) {
    try {
      await handleMaxUpdate(channelId, token, upd, { botUserId });
    } catch (e) {
      console.error('[max-poller] апдейт не обработан (канал', channelId, '):', e);
    }
  }
}

async function markConnected(channelId: string): Promise<void> {
  await db.channel
    .update({ where: { id: channelId }, data: { lastStatus: 'OK: получаю сообщения из MAX' } })
    .catch(() => {});
}

export type { MaxUpdate };

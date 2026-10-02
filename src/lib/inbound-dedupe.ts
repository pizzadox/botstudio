/**
 * Быстрая in-memory защита от повторной обработки входящих сообщений
 * (доставка и через long polling, и через вебхук; ретраи после таймаутов).
 *
 * Бэкстоп на случай рестарта процесса — уникальное поле
 * Message.externalKey в БД (см. processInbound).
 */

interface DedupeGlobal {
  __inboundDedupe?: Map<string, number>;
}

const g = globalThis as unknown as DedupeGlobal;

const TTL_MS = 10 * 60 * 1000; // 10 минут
const MAX_ENTRIES = 5000;

/** true — сообщение видно впервые (можно обрабатывать); false — уже обрабатывали. */
export function claimInboundKey(key: string): boolean {
  if (!key) return true;
  if (!g.__inboundDedupe) g.__inboundDedupe = new Map();
  const map = g.__inboundDedupe;
  const now = Date.now();

  // Периодическая чистка устаревших ключей
  if (map.size > MAX_ENTRIES) {
    for (const [k, ts] of map) {
      if (now - ts > TTL_MS) map.delete(k);
    }
  }

  const seen = map.get(key);
  if (seen !== undefined && now - seen < TTL_MS) return false;
  map.set(key, now);
  return true;
}

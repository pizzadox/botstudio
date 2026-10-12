/**
 * Простой in-memory rate limiter (волна 21) — без внешних зависимостей.
 * Скользящее окно на globalThis (переживает HMR в dev).
 *
 * Использование:
 *   if (!rateLimit('login:10.0.0.1', 5, 15 * 60_000)) → 429
 */

interface Bucket {
  hits: number[];
}

const store: Map<string, Bucket> =
  ((globalThis as Record<string, unknown>).__bstudioRateLimit as Map<string, Bucket>) ?? new Map();
(globalThis as Record<string, unknown>).__bstudioRateLimit = store;

/** Разрешить ли запрос: не больше limit попаданий за windowMs */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = store.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    store.set(key, bucket);
    return false;
  }
  bucket.hits.push(now);
  store.set(key, bucket);

  // Лёгкая чистка: не чаще раза в минуту, при заметном росте
  if (store.size > 2000 && now - ((globalThis as Record<string, unknown>).__bstudioRlSweep as number ?? 0) > 60_000) {
    (globalThis as Record<string, unknown>).__bstudioRlSweep = now;
    for (const [k, b] of store) {
      if (!b.hits.some((t) => now - t < windowMs)) store.delete(k);
    }
  }
  return true;
}

/**
 * IP-адрес клиента для ключей rate-limit'а.
 *
 * IMP-BE22-20: заголовки X-Forwarded-For / X-Real-IP подделываются клиентом,
 * поэтому доверяем им ТОЛЬКО когда приложение точно стоит за reverse-proxy —
 * флаг process.env.TRUST_PROXY === '1' (в песочнице/проде Caddy всегда ставит
 * XFF, в .env.local добавлен TRUST_PROXY=1).
 *
 * Если TRUST_PROXY не задан (прямая экспозиция без прокси) — возвращаем
 * 'unknown': лимитеры становятся общими «глобальными» бакетами. Это осознанный
 * безопасный дефолт: злоумышленник не может обойти лимит подменой заголовков
 * (цена — более грубое ограничение на таком развёртывании).
 */
export function clientIp(req: Request): string {
  if (process.env.TRUST_PROXY === '1') {
    const fwd = req.headers.get('x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim();
    return req.headers.get('x-real-ip') ?? 'unknown';
  }
  return 'unknown';
}

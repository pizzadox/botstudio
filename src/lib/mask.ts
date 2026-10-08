/**
 * Общее маскирование секретов (волна 21).
 * Реальные token/secret никогда не покидают сервер — фронт получает маску.
 */

/** «demo1234…x9A» — первые 4 и последние 3 символа, середина скрыта */
export function maskToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const t = token.trim();
  if (t.length <= 8) return `${t.slice(0, 2)}…••`;
  return `${t.slice(0, 4)}…${t.slice(-3)}`;
}

/** Готовый URL вебхука канала (секрет остаётся на сервере, фронт получает строку) */
export function webhookUrlFor(origin: string, type: string, secret: string): string {
  return `${origin}/api/webhook/${type}/${secret}`;
}

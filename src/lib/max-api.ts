/**
 * Клиент Bot API MAX (https://dev.max.ru).
 *
 * Важно (по актуальной документации):
 *  - токен передаётся ТОЛЬКО в заголовке `Authorization: <access_token>`;
 *    передача через query-параметр больше не поддерживается;
 *  - актуальный домен — platform-api2.max.ru, но из некоторых окружений он
 *    недоступен из-за сертификата Минцифры, поэтому по умолчанию используем
 *    botapi.max.ru (полностью совместим), а при ошибке пробуем резервные домены.
 */

const PRIMARY_BASE = process.env.MAX_API_BASE ?? 'https://botapi.max.ru';
const FALLBACK_BASES = ['https://platform-api.max.ru', 'https://platform-api2.max.ru'];

export interface MaxUser {
  user_id?: number;
  name?: string;
  first_name?: string;
  username?: string;
  is_bot?: boolean;
}

export interface MaxUpdate {
  update_type?: string;
  timestamp?: number;
  payload?: { message?: MaxMessage };
  message?: MaxMessage;
}

export interface MaxMessage {
  sender?: MaxUser;
  recipient?: { chat_id?: number; user_id?: number };
  body?: { mid?: string; text?: string; seq?: number };
  timestamp?: number;
}

async function apiFetch(
  path: string,
  token: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number }
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const bases = PRIMARY_BASE === FALLBACK_BASES[0] ? FALLBACK_BASES : [PRIMARY_BASE, ...FALLBACK_BASES];
  let lastError: unknown = null;

  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          Authorization: token,
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init?.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(init?.timeoutMs ?? 10000),
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      // 5xx — пробуем следующий домен
      if (res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      return { ok: res.ok, status: res.status, json };
    } catch (e) {
      lastError = e;
    }
  }
  console.error('[max-api] все домены недоступны:', lastError);
  return { ok: false, status: 0, json: null };
}

/** GET /me — информация о боте. */
export async function maxGetMe(token: string): Promise<{ ok: true; bot: MaxUser } | { ok: false; error: string }> {
  const res = await apiFetch('/me', token, { timeoutMs: 8000 });
  if (res.ok && res.json && typeof res.json === 'object') {
    return { ok: true, bot: res.json as MaxUser };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'неверный или отозванный токен' };
  const msg = (res.json as { message?: string } | null)?.message;
  return { ok: false, error: msg ?? `MAX API недоступен (HTTP ${res.status})` };
}

/** POST /messages — отправить текст в чат/диалог. */
export async function maxSendText(
  token: string,
  chatId: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch(`/messages?chat_id=${encodeURIComponent(chatId)}`, token, {
    method: 'POST',
    body: { text },
    timeoutMs: 10000,
  });
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'неверный или отозванный токен' };
  const msg = (res.json as { message?: string } | null)?.message;
  return { ok: false, error: msg ?? `MAX не принял сообщение (HTTP ${res.status})` };
}

/**
 * GET /updates — Long Polling.
 * Ответ: { updates: MaxUpdate[], marker: number | null }.
 */
export async function maxGetUpdates(
  token: string,
  marker?: number,
  timeoutSec = 25
): Promise<{ ok: true; updates: MaxUpdate[]; marker?: number } | { ok: false; error: string; status: number }> {
  const params = new URLSearchParams({ timeout: String(Math.min(Math.max(timeoutSec, 0), 90)) });
  if (marker !== undefined) params.set('marker', String(marker));
  const res = await apiFetch(`/updates?${params.toString()}`, token, {
    timeoutMs: (timeoutSec + 15) * 1000,
  });
  if (res.ok && res.json && typeof res.json === 'object') {
    const data = res.json as { updates?: MaxUpdate[]; marker?: number | null };
    return { ok: true, updates: data.updates ?? [], marker: data.marker ?? undefined };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'неверный или отозванный токен', status: res.status };
  }
  const msg = (res.json as { message?: string } | null)?.message;
  return { ok: false, error: msg ?? `MAX API недоступен (HTTP ${res.status})`, status: res.status };
}

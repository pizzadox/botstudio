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

/** Пауза между чанками одного сообщения (лимит MAX ~2 сообщения/сек на диалог) */
const CHUNK_DELAY_MS = 650;

export interface MaxUser {
  user_id?: number;
  name?: string;
  first_name?: string;
  username?: string;
  is_bot?: boolean;
}

export interface MaxButton {
  id: string;
  text: string;
}

export interface MaxUpdate {
  update_type?: string;
  timestamp?: number;
  payload?: {
    message?: MaxMessage;
    callback?: MaxCallback;
  };
  message?: MaxMessage;
  callback?: MaxCallback;
}

export interface MaxMessage {
  sender?: MaxUser;
  recipient?: { chat_id?: number; user_id?: number };
  body?: { mid?: string; text?: string; seq?: number };
  timestamp?: number;
}

export interface MaxCallback {
  callback_id?: string;
  user?: MaxUser;
  /** Строка, которую мы передали в payload кнопки */
  payload?: string;
  button?: { text?: string; payload?: string; intent?: string };
  message?: MaxMessage;
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

/** Клавиатура из кнопок сценария: каждая кнопка — отдельной строкой. */
function keyboardAttachment(buttons?: MaxButton[]): unknown[] | undefined {
  if (!buttons?.length) return undefined;
  return [
    {
      type: 'inline_keyboard',
      payload: {
        buttons: buttons.map((b) => [
          { type: 'callback', text: b.text, payload: b.text },
        ]),
      },
    },
  ];
}

/**
 * BE22-03: разбить длинный текст на чанки ≤ limit символов.
 * Резать стараемся по границам абзацев (\n\n), затем строк (\n),
 * и только в крайнем случае — жёстко. Кнопки (клавиатура) прикладываются
 * вызывающим кодом к ПОСЛЕДНЕМУ чанку.
 */
export function splitTextChunks(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  const softLimit = Math.floor(limit * 0.3); // граница не «съедает» начало чанка
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit - 1);
    if (cut < softLimit) cut = rest.lastIndexOf('\n', limit - 1);
    if (cut < softLimit) cut = limit; // жёсткий разрез — гарантия прогресса
    const piece = rest.slice(0, cut).trim();
    if (piece) chunks.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest || chunks.length === 0) chunks.push(rest);
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * POST /messages — отправить сообщение в чат/диалог.
 * Если переданы кнопки — добавляет inline_keyboard (callback-кнопки,
 * payload = текст кнопки, по нему движок матчит выбор пользователя).
 *
 * BE22-03: текст длиннее 3900 символов отправляется несколькими сообщениями
 * (границы абзацев/строк, чанки ≤ 3900); клавиатура — только у последнего
 * чанка. Последовательная отправка с паузой — лимит MAX ~2 сообщения/сек.
 */
export async function maxSendMessage(
  token: string,
  chatId: string,
  text: string,
  buttons?: MaxButton[]
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const attachments = keyboardAttachment(buttons);
  const chunks = splitTextChunks(text, 3900);

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const body: Record<string, unknown> = { text: chunks[i] };
    if (isLast && attachments) body.attachments = attachments;

    const res = await apiFetch(`/messages?chat_id=${encodeURIComponent(chatId)}`, token, {
      method: 'POST',
      body,
      timeoutMs: 10000,
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403)
        return { ok: false, status: res.status, error: 'неверный или отозванный токен' };
      const msg = (res.json as { message?: string } | null)?.message;
      return {
        ok: false,
        status: res.status,
        error: msg ?? `MAX не принял сообщение (HTTP ${res.status})`,
      };
    }
    if (!isLast) await sleep(CHUNK_DELAY_MS);
  }
  return { ok: true };
}

/** Совместимость: отправка простого текста без кнопок. */
export async function maxSendText(
  token: string,
  chatId: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  return maxSendMessage(token, chatId, text);
}

/**
 * POST /answers — ответ на нажатие кнопки (снимает «крутилку» с кнопки
 * и может сразу доставить сообщение).
 *  - с текстом → сообщение доставляется в чат;
 *  - без текста (silent) → только останавливаем «крутилку», без сообщения
 *    (иначе MAX получит заглушку — выглядело как «дубли одинаковых сообщений»).
 */
export async function maxAnswerCallback(
  token: string,
  callbackId: string,
  opts?: { text?: string; buttons?: MaxButton[]; silent?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  if (!callbackId) return { ok: false, error: 'callback_id не передан' };
  const text = opts?.text;
  const body: Record<string, unknown> =
    text && text.trim()
      ? (() => {
          const message: Record<string, unknown> = { text };
          const attachments = keyboardAttachment(opts?.buttons);
          if (attachments) message.attachments = attachments;
          return { message };
        })()
      : { silent: true };

  const res = await apiFetch(`/answers?callback_id=${encodeURIComponent(callbackId)}`, token, {
    method: 'POST',
    body,
    timeoutMs: 10000,
  });
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'неверный или отозванный токен' };
  const msg = (res.json as { message?: string } | null)?.message;
  return { ok: false, error: msg ?? `MAX не принял ответ на callback (HTTP ${res.status})` };
}

/**
 * GET /subscriptions — список активных вебхук-подписок бота.
 * Нужен, чтобы гарантировать одиночную доставку: long polling и вебхук
 * одновременно использовать нельзя, иначе сообщения будут дублироваться.
 */
export async function maxListSubscriptions(token: string): Promise<{ ok: boolean; urls: string[] }> {
  const res = await apiFetch('/subscriptions', token, { timeoutMs: 8000 });
  if (res.ok && res.json && typeof res.json === 'object') {
    const subs = (res.json as { subscriptions?: { url?: string }[] }).subscriptions ?? [];
    return { ok: true, urls: subs.map((s) => s.url ?? '').filter(Boolean) };
  }
  return { ok: false, urls: [] };
}

/** DELETE /subscriptions?url=... — отписаться от вебхука. */
export async function maxDeleteSubscription(token: string, url: string): Promise<boolean> {
  const res = await apiFetch(`/subscriptions?url=${encodeURIComponent(url)}`, token, {
    method: 'DELETE',
    timeoutMs: 8000,
  });
  return res.ok;
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

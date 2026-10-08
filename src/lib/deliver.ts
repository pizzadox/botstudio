import { db } from '@/lib/db';
import { maxSendMessage, splitTextChunks } from '@/lib/max-api';
import { inc } from '@/lib/metrics';

/**
 * Доставка сообщения оператора / системных уведомлений клиенту
 * в его мессенджер. Сообщение в БД сохраняется вызывающим кодом —
 * здесь только отправка «наружу».
 */

export interface DeliverResult {
  delivered: boolean;
  error?: string;
}

/** Кнопки для inline-клавиатуры мессенджера */
export interface DeliverButton {
  id: string;
  text: string;
}

/** BE22-03: лимит одного сообщения Telegram — 4096, страхуемся до 4000 */
const TELEGRAM_CHUNK_LIMIT = 4000;
/** BE22-03: пауза между чанками (Telegram: ~1 сообщение/сек на чат) */
const TELEGRAM_CHUNK_DELAY_MS = 1100;
/** BE22-10: один повтор при сетевом сбое/5xx — через 1.5 с */
const RETRY_DELAY_MS = 1500;

/** chat_id в мессенджерах — число; плейсхолдеры (user:...) не отправляем */
function isSendableChatId(id: string | null | undefined): id is string {
  return !!id && /^\d+$/.test(id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * BE22-04в: callback_data кнопки Telegram — это ТЕКСТ кнопки (лимит
 * Telegram — 64 байта). Кнопка «📦 Мои заявки» (кириллица ≈ 26 байт)
 * проходит; длинные подписи в inline НЕ попадают — вместо них в тексте
 * сообщения добавляется подсказка «напишите текстом» (движок матчит
 * свободный ввод). Обрезка до 60 символов не используется сознательно:
 * обрезанный текст не совпадёт с кнопкой сценария при матчинге движка.
 */
function callbackDataFor(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (Buffer.byteLength(t, 'utf8') <= 64) return t;
  return null;
}

/** Собрать inline_keyboard; вернуть и список кнопок, не влезших в клавиатуру */
function buildTelegramKeyboard(buttons?: DeliverButton[]): {
  keyboard?: { inline_keyboard: { text: string; callback_data: string }[][] };
  skipped: string[];
} {
  if (!buttons?.length) return { skipped: [] };
  const rows: { text: string; callback_data: string }[][] = [];
  const skipped: string[] = [];
  for (const b of buttons) {
    const cb = callbackDataFor(b.text);
    if (cb) rows.push([{ text: b.text, callback_data: cb }]);
    else skipped.push(b.text);
  }
  if (rows.length === 0) return { skipped };
  return { keyboard: { inline_keyboard: rows }, skipped };
}

/** BE22-10: один повтор при сетевом сбое/5xx (НЕ 4xx) через 1.5 с. */
async function sendWithRetry(
  send: () => Promise<{ ok: boolean; status?: number; error?: string }>
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const first = await send();
  if (first.ok) return first;
  const status = first.status ?? 0;
  // status 0 — сетевая ошибка/таймаут (соединение не состоялось)
  if (!(status === 0 || status >= 500)) return first;
  await sleep(RETRY_DELAY_MS);
  return send();
}

/**
 * Доставить сообщение (и при желании кнопки) в мессенджер клиента.
 * Кнопки приходят как inline_keyboard (MAX) / reply_markup (Telegram);
 * в веб-чате сообщения и кнопки подхватываются polling'ом из БД.
 */
/** Метрики-обёртка: каждая попытка доставки + учёт неудач (22-BE2 metrics) */
export async function deliverTextToConversation(
  conversationId: string,
  text: string,
  buttons?: DeliverButton[]
): Promise<DeliverResult> {
  const res = await deliverTextToConversationInner(conversationId, text, buttons);
  inc('deliveries');
  if (!res.delivered) inc('deliveryFailures');
  return res;
}

async function deliverTextToConversationInner(
  conversationId: string,
  text: string,
  buttons?: DeliverButton[]
): Promise<DeliverResult> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: { channel: true },
  });
  if (!conversation) return { delivered: false, error: 'conversation_not_found' };

  const { source } = conversation;
  const chatId = conversation.externalId;

  if (source === 'max') {
    const token = conversation.channel?.token;
    if (!token) return { delivered: false, error: 'no_channel_token' };
    if (!isSendableChatId(chatId)) return { delivered: false, error: 'no_chat_id' };
    // maxSendMessage сам чанкует текст > 3900 и вешает кнопки на последний чанк
    const res = await sendWithRetry(() => maxSendMessage(token, chatId, text, buttons));
    if (!res.ok) {
      console.error('[deliver→max]', chatId, res.error);
      await db.channel
        .update({
          where: { id: conversation.channel!.id },
          data: { lastStatus: `Ошибка отправки: ${res.error}` },
        })
        .catch(() => {});
      return { delivered: false, error: res.error };
    }
    // BE22-13: PII — в логе только длина текста, без содержимого
    console.log(`[deliver→max] чат ${chatId}: ${text.length} симв.`);
    return { delivered: true };
  }

  if (source === 'telegram') {
    const token = conversation.channel?.token;
    if (!token) return { delivered: false, error: 'no_channel_token' };
    if (!isSendableChatId(chatId)) return { delivered: false, error: 'no_chat_id' };

    // BE22-04в: кнопки, не влезшие в callback_data (текст > 64 байт),
    // уходят текстовой подсказкой в теле сообщения
    const { keyboard, skipped } = buildTelegramKeyboard(buttons);
    let effectiveText = text;
    if (skipped.length > 0) {
      effectiveText += '\n\nИли напишите текстом:\n' + skipped.map((t) => `• ${t}`).join('\n');
    }

    const sendTelegram = async (
      payload: Record<string, unknown>
    ): Promise<{ ok: boolean; status?: number; error?: string }> => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return { ok: false, status: res.status, error: `Telegram HTTP ${res.status}` };
        return { ok: true, status: res.status };
      } catch (e) {
        return { ok: false, status: 0, error: e instanceof Error ? e.message : 'telegram error' };
      }
    };

    // BE22-03: длинный текст — несколькими сообщениями ≤ 4000 (абзацы/строки);
    // inline-клавиатура — только у последнего чанка
    const chunks = splitTextChunks(effectiveText, TELEGRAM_CHUNK_LIMIT);
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const body: Record<string, unknown> = { chat_id: chatId, text: chunks[i] };
      if (isLast && keyboard) body.reply_markup = keyboard;

      const res = await sendWithRetry(() => sendTelegram(body));
      if (!res.ok) {
        console.error('[deliver→telegram]', chatId, res.error);
        return { delivered: false, error: res.error };
      }
      if (!isLast) await sleep(TELEGRAM_CHUNK_DELAY_MS);
    }
    // BE22-13: PII — без содержимого сообщения
    console.log(`[deliver→telegram] чат ${chatId}: ${text.length} симв., чанков ${chunks.length}`);
    return { delivered: true };
  }

  // web / simulator: клиент получает сообщения через polling — доставлено всегда
  return { delivered: true };
}

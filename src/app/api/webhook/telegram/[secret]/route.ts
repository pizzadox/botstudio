import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processInbound, type InboundResult } from '@/lib/webhook';
import { claimInboundKey } from '@/lib/inbound-dedupe';
import { deliverTextToConversation, type DeliverResult } from '@/lib/deliver';

type Params = { params: Promise<{ secret: string }> };

/**
 * Вебхук для Telegram Bot API.
 * Укажите этот URL (https://ваш-домен/api/webhook/telegram/<secret>) через setWebhook.
 *
 * Поддерживаемые апдейты:
 *  - message с текстом — как пользовательский ввод;
 *  - callback_query (BE22-04а) — нажатие inline-кнопки. callback_data — это
 *    ТЕКСТ кнопки (см. deliver.ts: в клавиатуру попадают только кнопки,
 *    чей текст укладывается в 64 байта; длинные — текстовой подсказкой
 *    в самом сообщении). Текст нажатия передаётся в processInbound как
 *    обычный ввод — движок матчит его как выбор кнопки сценария.
 *
 * Дедуп (BE22-04б): Telegram повторяет доставку, если вебхук не ответил 200
 * достаточно быстро. Повторы update_id отбрасываются in-memory claim'ом
 * (claimInboundKey из inbound-dedupe.ts: TTL 10 минут, cap 5000 с чисткой —
 * переиспользован вместо собственного Set). Дедуп, переживающий рестарт
 * процесса, обеспечивает unique(conversationId, externalKey) на Message:
 * message → ключ tg:<chat_id>:<message_id>, callback → tgcb:<callback_query_id>.
 */

/** Снять «часики» с inline-кнопки (Telegram ждёт answerCallbackQuery) */
async function ackTelegramCallback(token: string | null, callbackQueryId?: unknown): Promise<void> {
  if (!token || typeof callbackQueryId !== 'string' || !callbackQueryId) return;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

/** Отправить ответы бота (с кнопками/чанкованием/ретраем — всё внутри deliver) */
async function sendTelegramReplies(
  token: string | null,
  result: Extract<InboundResult, { ok: true }>
): Promise<void> {
  if (!token) return;
  let sent = 0;
  for (const m of result.messages) {
    if (sent > 0) await sleep(1100); // Telegram: ~1 сообщение/сек на чат
    sent += 1;
    const res: DeliverResult = await deliverTextToConversation(
      result.conversationId,
      m.text,
      m.buttons
    ).catch((e: unknown) => ({
      delivered: false,
      error: e instanceof Error ? e.message : 'deliver error',
    }));
    if (!res.delivered) {
      console.error('[telegram] не удалось доставить ответ:', res.error);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest, { params }: Params) {
  const { secret } = await params;
  const channel = await db.channel.findUnique({ where: { secret } });
  if (!channel || channel.type !== 'telegram') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  try {
    const update = await req.json();

    // BE22-04б: дедуп по update_id — повторная доставка отбрасывается сразу
    const updateId = typeof update?.update_id === 'number' ? update.update_id : null;
    if (updateId !== null && !claimInboundKey(`tg:${channel.id}:upd:${updateId}`)) {
      return NextResponse.json({ ok: true });
    }

    // BE22-04а: нажатие inline-кнопки
    const cb = update?.callback_query;
    if (cb) {
      const data = typeof cb.data === 'string' ? cb.data.trim() : '';
      if (!data) {
        await ackTelegramCallback(channel.token, cb.id);
        return NextResponse.json({ ok: true });
      }

      const chat = cb.message?.chat;
      const result = await processInbound(channel.id, {
        // callback может прийти без message.chat — processInbound найдёт
        // диалог по externalUserId (from.id) или создаст с плейсхолдером
        externalId: chat?.id != null ? String(chat.id) : undefined,
        externalUserId: cb.from?.id != null ? String(cb.from.id) : undefined,
        text: data.slice(0, 2000),
        contact: cb.from?.username
          ? `@${cb.from.username}`
          : (cb.from?.first_name ?? undefined),
        externalKey: typeof cb.id === 'string' && cb.id ? `tgcb:${cb.id}` : undefined,
      });

      // «Часики» с кнопки снимаем в любом случае (и при duplicate тоже)
      await ackTelegramCallback(channel.token, cb.id);

      if (result.ok && !result.duplicate) {
        await sendTelegramReplies(channel.token, result);
      }
      return NextResponse.json({ ok: true });
    }

    // Обычное текстовое сообщение
    const message = update?.message;
    const text: string | undefined = message?.text;
    if (message && text) {
      const chatId = String(message.chat?.id ?? message.from?.id ?? 'unknown');
      const result = await processInbound(channel.id, {
        externalId: chatId,
        externalUserId: message.from?.id != null ? String(message.from.id) : undefined,
        text: text.slice(0, 2000),
        contact: message.from?.username
          ? `@${message.from.username}`
          : (message.from?.first_name ?? undefined),
        // message_id уникален в пределах чата — ключ с chat_id
        externalKey:
          typeof message.message_id === 'number' && chatId
            ? `tg:${chatId}:${message.message_id}`
            : undefined,
      });

      if (result.ok && !result.duplicate) {
        await sendTelegramReplies(channel.token, result);
      }
    }
  } catch (err) {
    console.error('[telegram webhook]', err);
  }

  // Telegram требует 200, иначе будет повторять доставку
  return NextResponse.json({ ok: true });
}

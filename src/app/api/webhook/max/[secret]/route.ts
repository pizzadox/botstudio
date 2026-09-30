import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processInbound } from '@/lib/webhook';
import { claimInboundKey } from '@/lib/inbound-dedupe';
import {
  maxAnswerCallback,
  maxSendMessage,
  type MaxUpdate,
} from '@/lib/max-api';

type Params = { params: Promise<{ secret: string }> };

/**
 * Вебхук для мессенджера MAX (бот API).
 *
 * MAX присылает POST c объектом Update:
 *   { update_type: "message_created", payload: { message: {...} } }
 *   { update_type: "message_callback", payload: { callback: {...} } }
 *
 * Обычно вебхук не нужен — сообщения принимает встроенный long-polling
 * воркер (src/lib/max-poller.ts), который к тому же автоматически отписывает
 * вебхуки, чтобы не было двойной доставки. Этот роут остаётся для ручных
 * подписок через POST /subscriptions.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { secret } = await params;
  const channel = await db.channel.findUnique({ where: { secret } });
  if (!channel || channel.type !== 'max' || !channel.token) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  try {
    const body = (await req.json()) as MaxUpdate & Record<string, unknown>;

    const upd = body?.update_type ? body : null;
    const msg = upd?.payload?.message ?? (body.message as MaxUpdate['message']);
    const cb = upd?.payload?.callback ?? upd?.callback;

    if (cb) {
      await handleCallbackWebhook(channel.id, channel.token, cb);
    } else if (msg) {
      await handleMessageWebhook(channel.id, channel.token, msg);
    }
  } catch (err) {
    console.error('[max webhook]', err);
  }

  return NextResponse.json({ ok: true });
}

async function handleMessageWebhook(
  channelId: string,
  token: string,
  msg: NonNullable<MaxUpdate['message']>
) {
  const sender = msg.sender ?? {};
  if (sender.is_bot === true) return;

  const text = String(msg.body?.text ?? '').trim();
  const chatId = String(msg.recipient?.chat_id ?? sender.user_id ?? '');
  if (!chatId || !text) return;

  const mid = msg.body?.mid;
  if (mid && !claimInboundKey(`${channelId}:${mid}`)) return;

  const result = await processInbound(channelId, {
    externalId: chatId,
    text: text.slice(0, 2000),
    contact: sender.name ?? sender.first_name ?? sender.username,
    externalKey: mid,
  });

  if (!result.ok || result.duplicate) return;

  let sent = 0;
  for (const m of result.messages) {
    if (sent > 0) await new Promise((r) => setTimeout(r, 650));
    const res = await maxSendMessage(token, chatId, m.text, m.buttons);
    if (!res.ok) console.error('[max webhook] send:', res.error);
    sent += 1;
  }
}

async function handleCallbackWebhook(
  channelId: string,
  token: string,
  cb: NonNullable<MaxUpdate['callback']>
) {
  const callbackId = cb.callback_id ?? '';
  const choice = String(cb.button?.text ?? cb.payload ?? '').trim();
  const chatId = String(cb.message?.recipient?.chat_id ?? cb.user?.user_id ?? '');

  if (!choice || !chatId) {
    if (callbackId) await maxAnswerCallback(token, callbackId).catch(() => {});
    return;
  }

  if (callbackId && !claimInboundKey(`${channelId}:cb:${callbackId}`)) return;

  const result = await processInbound(channelId, {
    externalId: chatId,
    text: choice.slice(0, 2000),
    contact: cb.user?.name ?? cb.user?.first_name ?? cb.user?.username,
    externalKey: callbackId ? `cb:${callbackId}` : undefined,
  });

  if (!result.ok || result.duplicate) {
    if (callbackId) await maxAnswerCallback(token, callbackId).catch(() => {});
    return;
  }

  const [first, ...rest] = result.messages;
  if (callbackId) {
    await maxAnswerCallback(token, callbackId, first?.text, first?.buttons);
  } else if (first) {
    await maxSendMessage(token, chatId, first.text, first.buttons);
  }
  let sent = 1;
  for (const m of rest) {
    if (sent > 0) await new Promise((r) => setTimeout(r, 650));
    await maxSendMessage(token, chatId, m.text, m.buttons);
    sent += 1;
  }
}

/** MAX проверяет URL подписки GET-запросом — подтверждаем, что роут жив. */
export async function GET() {
  return NextResponse.json({ ok: true });
}

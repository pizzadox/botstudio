import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processInbound } from '@/lib/webhook';
import { maxSendText } from '@/lib/max-api';

type Params = { params: Promise<{ secret: string }> };

/**
 * Вебхук для мессенджера MAX (бот API).
 *
 * MAX присылает POST c объектом Update:
 *   { update_type: "message_created", payload: { message: { sender, recipient: { chat_id }, body: { text } } } }
 * Поддерживаем также упрощённые форматы { chat_id, text } и { message: {...} }.
 *
 * Обычно вебхук не нужен — сообщения принимает встроенный long-polling
 * воркер (src/lib/max-poller.ts). Этот роут полезен, если вы вручную
 * зарегистрировали подписку через POST /subscriptions.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { secret } = await params;
  const channel = await db.channel.findUnique({ where: { secret } });
  if (!channel || channel.type !== 'max') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  try {
    const body = await req.json();

    // Официальный формат: update.payload.message; запасные: body.message / body.text
    const upd = body?.update_type ? body : null;
    const msg = upd?.payload?.message ?? body?.message;
    const sender = msg?.sender ?? {};

    const text: string | undefined = msg?.body?.text ?? body?.text ?? msg?.text;
    const chatId: string | undefined = String(
      msg?.recipient?.chat_id ?? msg?.recipient?.user_id ?? sender.user_id ?? body?.chat_id ?? ''
    );
    const contact: string | undefined = sender.name ?? sender.first_name ?? sender.username ?? undefined;

    // Не отвечаем на собственные сообщения бота
    const isOwn = sender.is_bot === true;

    if (chatId && text && !isOwn) {
      const result = await processInbound(channel.id, {
        externalId: chatId,
        text: text.slice(0, 2000),
        contact,
      });

      // Отправка ответов через Bot API MAX (токен — только в заголовке Authorization)
      if (result.ok && channel.token) {
        for (const reply of result.replies) {
          const sent = await maxSendText(channel.token, chatId, reply);
          if (!sent.ok) console.error('[max webhook] send:', sent.error);
        }
      }
    }
  } catch (err) {
    console.error('[max webhook]', err);
  }

  return NextResponse.json({ ok: true });
}

/** MAX проверяет URL подписки GET-запросом — подтверждаем, что роут жив. */
export async function GET() {
  return NextResponse.json({ ok: true });
}

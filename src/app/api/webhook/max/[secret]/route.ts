import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processInbound } from '@/lib/webhook';

type Params = { params: Promise<{ secret: string }> };

/**
 * Вебхук для мессенджера MAX (бот API).
 * Принимает обновления вида {update_type:"message_created", message:{sender, recipient:{chat_id}, body:{text}}}
 * и простой формат {chat_id, text}.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { secret } = await params;
  const channel = await db.channel.findUnique({ where: { secret } });
  if (!channel || channel.type !== 'max') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  try {
    const body = await req.json();

    const msg = body?.message;
    const text: string | undefined =
      msg?.body?.text ?? body?.text ?? msg?.text;
    const chatId: string | undefined = String(
      msg?.recipient?.chat_id ?? msg?.sender?.user_id ?? body?.chat_id ?? ''
    );
    const contact: string | undefined =
      msg?.sender?.name ?? msg?.sender?.username ?? undefined;

    if (chatId && text) {
      const result = await processInbound(channel.id, {
        externalId: chatId,
        text: text.slice(0, 2000),
        contact,
      });

      // Отправка через Bot API MAX
      if (result.ok && channel.token) {
        for (const reply of result.replies) {
          await fetch(`https://botapi.max.ru/messages?access_token=${channel.token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: reply }),
            signal: AbortSignal.timeout(8000),
          }).catch((e) => console.error('[max send]', e));
        }
      }
    }
  } catch (err) {
    console.error('[max webhook]', err);
  }

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processInbound } from '@/lib/webhook';

type Params = { params: Promise<{ secret: string }> };

/**
 * Вебхук для Telegram Bot API.
 * Укажите этот URL (https://ваш-домен/api/webhook/telegram/<secret>) через setWebhook.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { secret } = await params;
  const channel = await db.channel.findUnique({ where: { secret } });
  if (!channel || channel.type !== 'telegram') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  try {
    const update = await req.json();
    const message = update?.message;
    const text: string | undefined = message?.text;

    if (message && text) {
      const result = await processInbound(channel.id, {
        externalId: String(message.chat?.id ?? message.from?.id ?? 'unknown'),
        text: text.slice(0, 2000),
        contact: message.from?.username
          ? `@${message.from.username}`
          : (message.from?.first_name ?? undefined),
      });

      if (result.ok && channel.token) {
        for (const reply of result.replies) {
          await fetch(`https://api.telegram.org/bot${channel.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: message.chat?.id, text: reply }),
            signal: AbortSignal.timeout(8000),
          }).catch((e) => console.error('[telegram send]', e));
        }
      }
    }
  } catch (err) {
    console.error('[telegram webhook]', err);
  }

  // Telegram требует 200, иначе будет повторять доставку
  return NextResponse.json({ ok: true });
}

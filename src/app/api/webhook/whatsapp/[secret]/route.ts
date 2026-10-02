import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processInbound } from '@/lib/webhook';

type Params = { params: Promise<{ secret: string }> };

/**
 * Вебхук для WhatsApp Cloud API (Meta).
 * Поддерживает формат Meta (entry→changes→value→messages) и простой JSON {from, text}.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { secret } = await params;
  const channel = await db.channel.findUnique({ where: { secret } });
  if (!channel || channel.type !== 'whatsapp') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  try {
    const body = await req.json();

    // Формат WhatsApp Cloud API
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const waMessage = value?.messages?.[0];
    let from: string | undefined = waMessage?.from;
    let text: string | undefined = waMessage?.text?.body;
    let contact: string | undefined =
      value?.contacts?.[0]?.profile?.name ?? waMessage?.from;

    // Простой формат {from, text}
    if (!from && body?.from) {
      from = String(body.from);
      text = String(body.text ?? '');
      contact = body.name;
    }

    if (from && text) {
      const result = await processInbound(channel.id, {
        externalId: String(from),
        text: text.slice(0, 2000),
        contact,
      });

      // Отправка через WhatsApp Cloud API (phone = Phone Number ID)
      if (result.ok && channel.token && channel.phone) {
        for (const reply of result.replies) {
          await fetch(`https://graph.facebook.com/v19.0/${channel.phone}/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${channel.token}`,
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: from,
              type: 'text',
              text: { body: reply },
            }),
            signal: AbortSignal.timeout(8000),
          }).catch((e) => console.error('[whatsapp send]', e));
        }
      }
    }
  } catch (err) {
    console.error('[whatsapp webhook]', err);
  }

  return NextResponse.json({ ok: true });
}

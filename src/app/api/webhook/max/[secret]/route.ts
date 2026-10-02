import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleMaxUpdate } from '@/lib/max-inbound';
import type { MaxUpdate } from '@/lib/max-api';

type Params = { params: Promise<{ secret: string }> };

/**
 * Вебхук для мессенджера MAX (бот API).
 *
 * MAX присылает POST c объектом Update (или { updates: [...] }):
 *   { update_type: "message_created", payload: { message: {...} } }
 *   { update_type: "message_callback", payload: { callback: {...} } }
 *
 * Обычно вебхук не нужен — сообщения принимает встроенный long-polling
 * воркер (src/lib/max-poller.ts), который к тому же автоматически отписывает
 * вебхуки, чтобы не было двойной доставки. Роут остаётся для ручных
 * подписок через POST /subscriptions и совместим с poller'ом через общий
 * обработчик src/lib/max-inbound.ts (дедупликация по mid/callback_id).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { secret } = await params;
  const channel = await db.channel.findUnique({ where: { secret } });
  if (!channel || channel.type !== 'max' || !channel.token) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  try {
    const body = (await req.json()) as MaxUpdate & {
      updates?: MaxUpdate[];
      message?: MaxUpdate['message'];
      callback?: MaxUpdate['callback'];
    };
    let updates: MaxUpdate[] = Array.isArray(body?.updates)
      ? body.updates
      : body?.update_type
        ? [body as MaxUpdate]
        : [];

    // Запасной формат: «голое» сообщение/callback без обёртки Update
    if (updates.length === 0 && (body?.message || body?.callback)) {
      if (body.callback) updates = [{ update_type: 'message_callback', payload: { callback: body.callback } }];
      else if (body.message) updates = [{ update_type: 'message_created', payload: { message: body.message } }];
    }

    for (const upd of updates) {
      await handleMaxUpdate(channel.id, channel.token, upd);
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

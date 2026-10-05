import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { deliverTextToConversation } from '@/lib/deliver';

type Params = { params: Promise<{ id: string; orderId: string }> };

/**
 * Чат по заявке: сообщения, привязанные к заявке (Message.orderId).
 * Пользователь пишет их в боте в режиме «чат по заявке»,
 * оператор отвечает здесь — ответ доставляется клиенту в мессенджер.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id, orderId } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  const order = await db.order.findFirst({ where: { id: orderId, botId: id } });
  if (!order) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 });

  const messages = await db.message.findMany({
    where: { orderId },
    orderBy: { createdAt: 'asc' },
    take: 300,
  });

  return NextResponse.json({ messages });
}

/** Ответ оператора в чате заявки (доставляется клиенту в мессенджер) */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, orderId } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  const order = await db.order.findFirst({ where: { id: orderId, botId: id } });
  if (!order) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 });

  try {
    const body = await req.json();
    const text = String(body.text ?? '').trim().slice(0, 2000);
    if (!text) return NextResponse.json({ error: 'Пустое сообщение' }, { status: 400 });

    // У демо-заявок может не быть диалога — сообщение некуда писать
    if (!order.conversationId) {
      return NextResponse.json(
        { error: 'К этой заявке не привязан диалог с клиентом', code: 'no_conversation' },
        { status: 409 }
      );
    }

    const message = await db.message.create({
      data: { conversationId: order.conversationId, role: 'bot', text, nodeId: '__operator', orderId },
    });
    if (order.conversationId) {
      await db.conversation
        .update({ where: { id: order.conversationId }, data: { updatedAt: new Date() } })
        .catch(() => {});
    }

    // Доставка клиенту в мессенджер (MAX/Telegram); для веба клиент заберёт
    // ответ polling'ом
    const delivery = await deliverTextToConversation(order.conversationId, text);

    return NextResponse.json({
      message: {
        id: message.id,
        role: message.role,
        text: message.text,
        nodeId: message.nodeId,
        orderId: message.orderId,
        createdAt: message.createdAt,
      },
      delivered: delivery.delivered,
      deliveryError: delivery.error,
    });
  } catch (err) {
    console.error('[order chat send]', err);
    return NextResponse.json({ error: 'Не удалось отправить' }, { status: 500 });
  }
}

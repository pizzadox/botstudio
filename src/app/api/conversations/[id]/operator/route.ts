import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { deliverTextToConversation } from '@/lib/deliver';

type Params = { params: Promise<{ id: string }> };

/** Ответ оператора в диалог (виден пользователю как сообщение бота/поддержки) */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const conversation = await db.conversation.findUnique({ where: { id }, include: { bot: true } });
  if (!conversation || conversation.bot.userId !== user.id) {
    return NextResponse.json({ error: 'Диалог не найден' }, { status: 404 });
  }

  try {
    const body = await req.json();
    const text = String(body.text ?? '').trim().slice(0, 2000);
    if (!text) return NextResponse.json({ error: 'Пустое сообщение' }, { status: 400 });

    // Вставка сообщения и обновление времени диалога независимы — параллельно
    const [message] = await Promise.all([
      db.message.create({
        data: { conversationId: conversation.id, role: 'bot', text, nodeId: '__operator' },
      }),
      db.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      }),
    ]);

    // Доставка в мессенджер клиента (MAX/Telegram); для веба клиент заберёт
    // ответ polling'ом — ошибки отправки не валим в 500
    const delivery = await deliverTextToConversation(conversation.id, text);

    return NextResponse.json({
      message: { id: message.id, role: message.role, text: message.text, createdAt: message.createdAt },
      delivered: delivery.delivered,
      deliveryError: delivery.error,
    });
  } catch (err) {
    console.error('[operator reply]', err);
    return NextResponse.json({ error: 'Не удалось отправить' }, { status: 500 });
  }
}

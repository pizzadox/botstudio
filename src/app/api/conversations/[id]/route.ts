import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

/** Cap для ?take — защита от «выкачаем всю таблицу» */
const MAX_TAKE = 500;

async function ownedConversation(req: NextRequest, id: string) {
  const user = await getSessionUser(req);
  if (!user) return { error: 'auth' as const };
  const conversation = await db.conversation.findUnique({
    where: { id },
    include: { bot: true },
  });
  if (!conversation || conversation.bot.userId !== user.id) return { error: 'notfound' as const };
  return { conversation };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { conversation, error } = await ownedConversation(req, id);
  if (error === 'auth') return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
  if (!conversation) return NextResponse.json({ error: 'Диалог не найден' }, { status: 404 });

  // ?take=N (по умолчанию 200, максимум 500). Выборка «последние N» идёт по
  // индексу (conversationId, createdAt) DESC, затем разворачиваем — в ответе
  // сообщения по-прежнему идут в хронологическом порядке, но это САМЫЕ СВЕЖИЕ N,
  // а не самые старые, как было при asc+take.
  const takeParam = Number(req.nextUrl.searchParams.get('take') ?? '');
  const take =
    Number.isFinite(takeParam) && takeParam > 0 ? Math.min(Math.floor(takeParam), MAX_TAKE) : 200;

  const [messages] = await Promise.all([
    db.message
      .findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        take,
      })
      .then((rows) => rows.reverse()),
    // Оператор открыл диалог — помечаем прочитанным (для счётчика «новые»);
    // не зависит от выборки сообщений — выполняем параллельно
    db.conversation.update({
      where: { id: conversation.id },
      data: { operatorReadAt: new Date() },
    }),
  ]);

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      source: conversation.source,
      contact: conversation.contact,
      needsOperator: conversation.needsOperator,
      status: conversation.status,
      createdAt: conversation.createdAt,
    },
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      nodeId: m.nodeId,
      createdAt: m.createdAt,
    })),
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { conversation, error } = await ownedConversation(req, id);
  if (error === 'auth') return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
  if (!conversation) return NextResponse.json({ error: 'Диалог не найден' }, { status: 404 });

  await db.conversation.delete({ where: { id: conversation.id } });
  return NextResponse.json({ ok: true });
}

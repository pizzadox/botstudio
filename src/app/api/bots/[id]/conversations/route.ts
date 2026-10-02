import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

/** Список диалогов бота (инбокс оператора) */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  const conversations = await db.conversation.findMany({
    where: { botId: bot.id },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    include: {
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json({
    conversations: conversations.map((c) => {
      const last = c.messages[0] ?? null;
      // Непрочитано оператором: была активность после последнего открытия диалога
      const unread =
        c.status === 'open' &&
        (!c.operatorReadAt || new Date(c.updatedAt) > new Date(c.operatorReadAt));
      return {
        id: c.id,
        source: c.source,
        contact: c.contact,
        externalId: c.externalId,
        needsOperator: c.needsOperator,
        status: c.status,
        unread,
        messagesCount: c._count.messages,
        updatedAt: c.updatedAt,
        lastMessage: last,
      };
    }),
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

/** Cap для ?take — защита от «выкачаем всю таблицу» (IMP-BE21-21) */
const MAX_TAKE = 500;

/** Список диалогов бота (инбокс оператора).
 *  Select только нужных скаляров — БЕЗ тяжёлого поля state (JSON состояния
 *  движка): инбокс его не читает, а на 100 диалогов это заметный оверхед.
 *  ?take=N (дефолт 100, максимум 500) — фронт может запросить больше истории. */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  const takeParam = Number(req.nextUrl.searchParams.get('take') ?? '');
  const take =
    Number.isFinite(takeParam) && takeParam > 0 ? Math.min(Math.floor(takeParam), MAX_TAKE) : 100;

  const conversations = await db.conversation.findMany({
    where: { botId: bot.id },
    // IMP-BE22-12b: закреплённые диалоги сверху (pinnedAt desc, null'ы — в конец),
    // далее — обычный порядок по активности
    orderBy: [{ pinnedAt: 'desc' }, { updatedAt: 'desc' }],
    take,
    select: {
      id: true,
      channelId: true,
      source: true,
      externalId: true,
      externalUserId: true,
      contact: true,
      needsOperator: true,
      status: true,
      operatorReadAt: true,
      pinnedAt: true,
      createdAt: true,
      updatedAt: true,
      // Последнее сообщение — лёгкий select (id/role/text/createdAt)
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, role: true, text: true, createdAt: true },
      },
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
        // IMP-BE22-12b: флаг закрепления (ставится через POST .../conversations/[id]/pin)
        pinned: c.pinnedAt != null,
        pinnedAt: c.pinnedAt,
        messagesCount: c._count.messages,
        updatedAt: c.updatedAt,
        lastMessage: last,
      };
    }),
  });
}

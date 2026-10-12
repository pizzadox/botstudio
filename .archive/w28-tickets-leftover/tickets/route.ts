import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

/**
 * Реестр заявок бота («Заявки» в ЛК).
 * GET /api/bots/[id]/tickets?status=new&conversationId=...
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const conversationId = url.searchParams.get('conversationId');

  const where: Record<string, unknown> = { botId: bot.id };
  if (status) where.status = status;
  if (conversationId) where.conversationId = conversationId;

  const tickets = await db.ticket.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      conversation: { select: { id: true, contact: true, source: true } },
    },
  });

  const counts = await db.ticket.groupBy({
    by: ['status'],
    where: { botId: bot.id },
    _count: { _all: true },
  });
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const g of counts) {
    byStatus[g.status] = g._count._all;
    total += g._count._all;
  }

  return NextResponse.json({ tickets, counts: byStatus, total });
}

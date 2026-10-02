import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { parseMytkoConfig } from '@/lib/mytko';

type Params = { params: Promise<{ id: string }> };

/**
 * Заявки, связанные с диалогом: созданные в нём (conversationId)
 * или оставленные этим же клиентом в боте (externalUserId).
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const conversation = await db.conversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: 'Диалог не найден' }, { status: 404 });

  const bot = await db.bot.findUnique({ where: { id: conversation.botId } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Диалог не найден' }, { status: 404 });
  }

  const orders = await db.order.findMany({
    where: {
      botId: bot.id,
      OR: [{ conversationId: conversation.id }, { externalUserId: conversation.externalUserId ?? '__none__' }],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      number: true,
      type: true,
      status: true,
      address: true,
      city: true,
      size: true,
      wishDate: true,
      clientName: true,
      phone: true,
      assignee: true,
      mytkoStatus: true,
      mytkoInfo: true,
      mytkoSyncAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    orders,
    mytkoEnabled: parseMytkoConfig(bot.mytkoConfig).enabled,
  });
}

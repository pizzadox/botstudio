import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { defaultFlow } from '@/lib/flow-engine';

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bots = await db.bot.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    include: {
      channels: { select: { id: true, type: true, active: true } },
      _count: { select: { conversations: true, channels: true } },
    },
  });

  const botIds = bots.map((b) => b.id);
  const [conversations, messages, operators, channelCount] = await Promise.all([
    db.conversation.count({ where: { botId: { in: botIds } } }),
    db.message.count({ where: { conversation: { botId: { in: botIds } } } }),
    db.conversation.count({ where: { botId: { in: botIds }, needsOperator: true, status: 'open' } }),
    db.channel.count({ where: { botId: { in: botIds }, active: true } }),
  ]);

  return NextResponse.json({
    bots: bots.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      status: b.status,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      channelsCount: b._count.channels,
      conversationsCount: b._count.conversations,
      channelTypes: b.channels.map((c) => c.type),
    })),
    stats: {
      bots: bots.length,
      conversations,
      messages,
      needsOperator: operators,
      activeChannels: channelCount,
    },
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  try {
    const body = await req.json();
    const name = String(body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'Укажите название бота' }, { status: 400 });
    const description = String(body.description ?? '').trim() || null;

    const bot = await db.bot.create({
      data: {
        userId: user.id,
        name,
        description,
        flow: JSON.stringify(defaultFlow()),
      },
    });
    return NextResponse.json({ bot: { id: bot.id, name: bot.name } });
  } catch (err) {
    console.error('[bots POST]', err);
    return NextResponse.json({ error: 'Не удалось создать бота' }, { status: 500 });
  }
}

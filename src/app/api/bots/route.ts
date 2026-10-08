import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { defaultFlow } from '@/lib/flow-engine';

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bots = await db.bot.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      /// Настройки MyTKO — для бейджа «синхронизировано с MyTKO» на карточке
      mytkoConfig: true,
      channels: { select: { id: true, type: true, active: true } },
      _count: { select: { conversations: true, channels: true } },
    },
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
  });

  const botIds = bots.map((b) => b.id);
  const [conversations, messages, operators, channelCount] = await Promise.all([
    db.conversation.count({ where: { botId: { in: botIds } } }),
    db.message.count({ where: { conversation: { botId: { in: botIds } } } }),
    db.conversation.count({ where: { botId: { in: botIds }, needsOperator: true, status: 'open' } }),
    db.channel.count({ where: { botId: { in: botIds }, active: true } }),
  ]);

  return NextResponse.json({
    bots: bots.map((b) => {
      let mytko: { enabled: boolean; hasToken: boolean } | null = null;
      try {
        const cfg = JSON.parse(b.mytkoConfig ?? '{}') as {
          enabled?: boolean;
          token?: string;
        };
        if (cfg.enabled || cfg.token) {
          mytko = {
            enabled: cfg.enabled === true,
            hasToken: !!cfg.token,
          };
        }
      } catch {
        mytko = null;
      }
      return {
        id: b.id,
        name: b.name,
        description: b.description,
        status: b.status,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        mytko,
        channelsCount: b._count.channels,
        conversationsCount: b._count.conversations,
        channelTypes: b.channels.map((c) => c.type),
      };
    }),
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
    // IMP-BE21-12: ограничиваем длину строк (name ≤120, description ≤500)
    const name = (String(body.name ?? '').trim() || '').slice(0, 120);
    if (!name) return NextResponse.json({ error: 'Укажите название бота' }, { status: 400 });
    const description = String(body.description ?? '').trim().slice(0, 500) || null;

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

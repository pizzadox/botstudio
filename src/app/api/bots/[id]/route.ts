import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

async function ownedBot(req: NextRequest, id: string) {
  const user = await getSessionUser(req);
  if (!user) return { error: 'auth' as const };
  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) return { error: 'notfound' as const };
  return { bot };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { bot, error } = await ownedBot(req, id);
  if (error === 'auth') return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
  if (!bot) return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });

  const channels = await db.channel.findMany({
    where: { botId: bot.id },
    orderBy: { createdAt: 'asc' },
  });
  const conversationsCount = await db.conversation.count({ where: { botId: bot.id } });

  return NextResponse.json({ bot, channels, conversationsCount });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { bot, error } = await ownedBot(req, id);
  if (error === 'auth') return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
  if (!bot) return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });

  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};

    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
    if (typeof body.description === 'string') data.description = body.description.trim() || null;
    if (typeof body.status === 'string' && ['draft', 'published'].includes(body.status)) {
      data.status = body.status;
    }
    if (body.flow !== undefined) {
      if (typeof body.flow !== 'object' || body.flow === null) {
        return NextResponse.json({ error: 'Некорректный формат сценария' }, { status: 400 });
      }
      const f = body.flow as { nodes?: unknown; edges?: unknown };
      if (!Array.isArray(f.nodes) || !Array.isArray(f.edges)) {
        return NextResponse.json({ error: 'Некорректный формат сценария' }, { status: 400 });
      }
      data.flow = JSON.stringify(f);
    }

    const updated = await db.bot.update({ where: { id: bot.id }, data });
    return NextResponse.json({ bot: updated });
  } catch (err) {
    console.error('[bots PUT]', err);
    return NextResponse.json({ error: 'Не удалось сохранить' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { bot, error } = await ownedBot(req, id);
  if (error === 'auth') return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
  if (!bot) return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });

  await db.bot.delete({ where: { id: bot.id } });
  return NextResponse.json({ ok: true });
}

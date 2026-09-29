import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const channel = await db.channel.findUnique({ where: { id }, include: { bot: true } });
  if (!channel || channel.bot.userId !== user.id) {
    return NextResponse.json({ error: 'Канал не найден' }, { status: 404 });
  }

  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};
    if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim();
    if (typeof body.token === 'string') data.token = body.token.trim() || null;
    if (typeof body.phone === 'string') data.phone = body.phone.trim() || null;
    if (typeof body.active === 'boolean') data.active = body.active;

    const updated = await db.channel.update({ where: { id: channel.id }, data });
    return NextResponse.json({ channel: updated });
  } catch (err) {
    console.error('[channels PUT]', err);
    return NextResponse.json({ error: 'Не удалось обновить канал' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const channel = await db.channel.findUnique({ where: { id }, include: { bot: true } });
  if (!channel || channel.bot.userId !== user.id) {
    return NextResponse.json({ error: 'Канал не найден' }, { status: 404 });
  }

  await db.channel.delete({ where: { id: channel.id } });
  return NextResponse.json({ ok: true });
}

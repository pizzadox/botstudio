import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { maskToken, webhookUrlFor } from '@/lib/mask';
import type { Channel } from '@prisma/client';

type Params = { params: Promise<{ id: string }> };

/** Санитайзер канала: token не покидает сервер (IMP-BE21-01) */
function sanitizeChannel(ch: Channel, origin: string) {
  return {
    id: ch.id,
    botId: ch.botId,
    type: ch.type,
    title: ch.title,
    tokenMasked: maskToken(ch.token),
    hasToken: !!ch.token,
    phone: ch.phone,
    secret: ch.secret,
    webhookUrl: webhookUrlFor(origin, ch.type, ch.secret),
    active: ch.active,
    lastStatus: ch.lastStatus,
    createdAt: ch.createdAt,
  };
}

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
    if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim().slice(0, 120);
    // Пустой/не переданный token = «не менять» (фронт не знает старого токена —
    // он никогда не покидает сервер), только непустая строка перезаписывает
    if (typeof body.token === 'string' && body.token.trim()) data.token = body.token.trim();
    if (typeof body.phone === 'string') data.phone = body.phone.trim() || null;
    if (typeof body.active === 'boolean') data.active = body.active;

    const updated = await db.channel.update({ where: { id: channel.id }, data });
    const origin = new URL(req.url).origin;
    return NextResponse.json({ channel: sanitizeChannel(updated, origin) });
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

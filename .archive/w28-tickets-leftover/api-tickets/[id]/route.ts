import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

const STATUSES = ['new', 'in_progress', 'done', 'canceled'];

/** PATCH /api/tickets/[id] — статус и/или исполнитель заявки. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const ticket = await db.ticket.findUnique({ where: { id }, include: { bot: true } });
  if (!ticket || ticket.bot.userId !== user.id) {
    return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const data: { status?: string; assignee?: string | null } = {};

  if (typeof body?.status === 'string' && STATUSES.includes(body.status)) {
    data.status = body.status;
    // при смене статуса на «в работе» автоматически фиксируем исполнителя
    if (body.status === 'in_progress' && !body.assignee) {
      data.assignee = user.name || user.username;
    }
  }
  if (body?.assignee !== undefined) {
    data.assignee = typeof body.assignee === 'string' && body.assignee.trim() ? body.assignee.trim() : null;
  }

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: 'Нечего обновлять' }, { status: 400 });
  }

  const updated = await db.ticket.update({ where: { id }, data });
  return NextResponse.json({ ticket: updated });
}

/** GET /api/tickets/[id] — карточка заявки. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const ticket = await db.ticket.findUnique({
    where: { id },
    include: { bot: true, conversation: { select: { id: true, contact: true, source: true } } },
  });
  if (!ticket || ticket.bot.userId !== user.id) {
    return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 });
  }
  return NextResponse.json({ ticket });
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { geocodeAddress } from '@/lib/orders';

type Params = { params: Promise<{ id: string; orderId: string }> };

const FINAL_STATUSES = ['completed', 'cancelled'];

async function loadOwnedOrder(req: NextRequest, botId: string, orderId: string) {
  const user = await getSessionUser(req);
  if (!user) return { error: 'unauthorized' as const };
  const bot = await db.bot.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== user.id) return { error: 'notfound' as const };
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      conversation: {
        select: { id: true, contact: true, source: true, externalUserId: true, needsOperator: true },
      },
    },
  });
  if (!order || order.botId !== botId) return { error: 'notfound' as const };
  return { user, bot, order };
}

/** Карточка заявки: данные, клиент, история его заказов, чат по заявке */
export async function GET(req: NextRequest, { params }: Params) {
  const { id, orderId } = await params;
  const loaded = await loadOwnedOrder(req, id, orderId);
  if ('error' in loaded) {
    return NextResponse.json(
      { error: loaded.error === 'unauthorized' ? 'Требуется авторизация' : 'Заявка не найдена' },
      { status: loaded.error === 'unauthorized' ? 401 : 404 }
    );
  }
  const { order } = loaded;

  const [clientOrders, messages] = await Promise.all([
    order.externalUserId
      ? db.order.findMany({
          where: { botId: id, externalUserId: order.externalUserId },
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve([]),
    db.message.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      take: 300,
    }),
  ]);

  return NextResponse.json({ order, clientOrders, messages });
}

/** Обновление заявки: статус, исполнитель, координаты, данные клиента */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, orderId } = await params;
  const loaded = await loadOwnedOrder(req, id, orderId);
  if ('error' in loaded) {
    return NextResponse.json(
      { error: loaded.error === 'unauthorized' ? 'Требуется авторизация' : 'Заявка не найдена' },
      { status: loaded.error === 'unauthorized' ? 401 : 404 }
    );
  }
  const { order } = loaded;

  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};

    if (typeof body.status === 'string' && ['new', 'assigned', 'in_progress', 'completed', 'cancelled'].includes(body.status)) {
      data.status = body.status;
      data.completedAt = FINAL_STATUSES.includes(body.status) ? new Date() : null;
    }
    if (typeof body.assignee === 'string') data.assignee = body.assignee.trim().slice(0, 120) || null;
    if (typeof body.comment === 'string') data.comment = body.comment.trim().slice(0, 1000) || null;
    if (typeof body.wishDate === 'string') data.wishDate = body.wishDate.trim().slice(0, 120) || null;
    if (typeof body.phone === 'string') data.phone = body.phone.trim().slice(0, 40) || null;
    if (typeof body.clientName === 'string') data.clientName = body.clientName.trim().slice(0, 120) || null;
    if (typeof body.size === 'string') data.size = body.size.trim().slice(0, 200) || null;
    if (typeof body.address === 'string') data.address = body.address.trim().slice(0, 300) || null;

    if (typeof body.lat === 'number' && Number.isFinite(body.lat)) data.lat = body.lat;
    if (typeof body.lng === 'number' && Number.isFinite(body.lng)) data.lng = body.lng;
    if (body.lat === null || body.lng === null) {
      data.lat = null;
      data.lng = null;
    }

    // Перегеокодировать адрес по требованию оператора
    if (body.geocode === true) {
      const addr = (typeof data.address === 'string' ? data.address : order.address) ?? '';
      const geo = await geocodeAddress(addr);
      data.lat = geo?.lat ?? null;
      data.lng = geo?.lng ?? null;
    }

    const updated = await db.order.update({ where: { id: orderId }, data });
    return NextResponse.json({ order: updated });
  } catch (err) {
    console.error('[orders patch]', err);
    return NextResponse.json({ error: 'Не удалось обновить заявку' }, { status: 500 });
  }
}

/** Удалить заявку (например, демо-данные) */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, orderId } = await params;
  const loaded = await loadOwnedOrder(req, id, orderId);
  if ('error' in loaded) {
    return NextResponse.json(
      { error: loaded.error === 'unauthorized' ? 'Требуется авторизация' : 'Заявка не найдена' },
      { status: loaded.error === 'unauthorized' ? 401 : 404 }
    );
  }
  await db.order.delete({ where: { id: orderId } });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { geocodeAddress, reverseGeocode } from '@/lib/orders';
import { parseMytkoConfig } from '@/lib/mytko';

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

  return NextResponse.json({
    order,
    clientOrders,
    messages,
    mytkoEnabled: parseMytkoConfig(loaded.bot.mytkoConfig).enabled,
  });
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
    if (typeof body.city === 'string') data.city = body.city.trim().slice(0, 120) || null;

    if (typeof body.lat === 'number' && Number.isFinite(body.lat)) {
      data.lat = body.lat;
      data.geoSource = 'manual';
    }
    if (typeof body.lng === 'number' && Number.isFinite(body.lng)) {
      data.lng = body.lng;
      data.geoSource = 'manual';
    }
    if (body.lat === null || body.lng === null) {
      data.lat = null;
      data.lng = null;
      data.geoSource = null;
    }

    // Точку поставили/сдвинули вручную — адрес подтягиваем под точку
    // (обратный геокодинг). Если сервис не ответил — адрес не трогаем.
    const manualPoint =
      (typeof data.lat === 'number' || typeof data.lng === 'number') &&
      data.geoSource === 'manual' &&
      body.geocode !== true;
    if (manualPoint) {
      const rev = await reverseGeocode(
        (data.lat as number) ?? order.lat!,
        (data.lng as number) ?? order.lng!
      );
      if (rev?.address) {
        // Полный адрес: город (если распознался) + улица/дом
        data.address = rev.city ? `${rev.city}, ${rev.address}` : rev.address;
        if (rev.city) data.city = rev.city;
      }
    }

    // Перегеокодировать адрес по требованию оператора.
    // Ручная точка не теряется: если адрес не нашёлся — прежние координаты остаются.
    let geoResult: { ok: boolean; lat?: number; lng?: number } | undefined;
    if (body.geocode === true) {
      const addr = (typeof data.address === 'string' ? data.address : order.address) ?? '';
      const geo = await geocodeAddress(addr);
      if (geo) {
        data.lat = geo.lat;
        data.lng = geo.lng;
        data.geoSource = 'geocode';
        geoResult = { ok: true, lat: geo.lat, lng: geo.lng };
      } else {
        // Координаты не трогаем: неудачный поиск не должен сдвигать/стирать точку
        delete data.lat;
        delete data.lng;
        geoResult = { ok: false };
      }
    }

    const updated = await db.order.update({ where: { id: orderId }, data });
    return NextResponse.json({ order: updated, geo: geoResult });
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

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { createOrder, geocodeAddress } from '@/lib/orders';
import { parseMytkoConfig } from '@/lib/mytko';

type Params = { params: Promise<{ id: string }> };

/** Cap для ?take — защита от «выкачаем всю таблицу» (IMP-BE21-21) */
const MAX_TAKE = 500;

/** Список заявок бота — карта, активные, архив. ?take=N (дефолт 500, cap 500). */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  // Список заявок: select всех скаляров (нужны для карты/карточек/поиска) +
  // только нужные поля диалога; ?take (дефолт 500) — растущий список не «тянем» целиком.
  // Порядок прежний: createdAt desc (новые сверху).
  const takeParam = Number(req.nextUrl.searchParams.get('take') ?? '');
  const take =
    Number.isFinite(takeParam) && takeParam > 0 ? Math.min(Math.floor(takeParam), MAX_TAKE) : 500;
  const [ordersRaw, cfg] = await Promise.all([
    db.order.findMany({
      where: { botId: id },
      select: {
        id: true,
        botId: true,
        conversationId: true,
        externalUserId: true,
        number: true,
        type: true,
        clientName: true,
        phone: true,
        city: true,
        address: true,
        size: true,
        wishDate: true,
        comment: true,
        status: true,
        assignee: true,
        lat: true,
        lng: true,
        geoSource: true,
        mytkoStatus: true,
        mytkoSyncAt: true,
        mytkoInfo: true,
        mytkoError: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        conversation: { select: { contact: true, source: true, externalUserId: true } },
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    }),
    Promise.resolve(parseMytkoConfig(bot.mytkoConfig)),
  ]);

  // messagesCount — аддитивное поле для чипа «N сообщ.» в списке (форма _count сохранена)
  const orders = ordersRaw.map((o) => ({ ...o, messagesCount: o._count.messages }));

  return NextResponse.json({ orders, mytkoEnabled: cfg.enabled });
}

/** Создать заявку вручную (оператор из ЛК) */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  try {
    const body = await req.json();
    const address = String(body.address ?? '').trim().slice(0, 300) || null;

    let lat = typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : null;
    let lng = typeof body.lng === 'number' && Number.isFinite(body.lng) ? body.lng : null;
    let geoSource: string | null = lat != null && lng != null ? 'manual' : null;
    if (lat == null && lng == null && address) {
      const geo = await geocodeAddress(address);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
        geoSource = 'geocode';
      }
    }

    const order = await createOrder({
      botId: id,
      type: ['waste', 'kgm', 'other'].includes(body.type) ? body.type : 'other',
      clientName: String(body.clientName ?? '').trim().slice(0, 120) || null,
      phone: String(body.phone ?? '').trim().slice(0, 40) || null,
      city: String(body.city ?? '').trim().slice(0, 120) || null,
      address,
      size: String(body.size ?? '').trim().slice(0, 200) || null,
      wishDate: String(body.wishDate ?? '').trim().slice(0, 120) || null,
      comment: String(body.comment ?? '').trim().slice(0, 1000) || null,
      lat,
      lng,
      geoSource,
    });

    return NextResponse.json({ order }, { status: 201 });
  } catch (err) {
    console.error('[orders create]', err);
    return NextResponse.json({ error: 'Не удалось создать заявку' }, { status: 500 });
  }
}

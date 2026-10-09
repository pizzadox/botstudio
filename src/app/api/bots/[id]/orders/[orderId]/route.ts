import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import {
  geocodeAddress,
  geocodeOrderAddress,
  reverseGeocode,
  normalizePhone, // IMP-25-07: нормализация телефона в PATCH
} from '@/lib/orders';
import { composeAddress } from '@/lib/cities'; // IMP-23-BE-06: чистая сборка адреса
import { parseWishDate, moscowNoonUTC } from '@/lib/wish-date'; // IMP-24-BE-12 / IMP-25-06
import { parseMytkoConfig } from '@/lib/mytko';
import { checkStatusTransition } from '@/lib/order-status';

type Params = { params: Promise<{ id: string; orderId: string }> };

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
      // IMP-24-BE-09: экипаж попадает в ответ {order} карточки
      crew: { select: { id: true, name: true, phone: true } },
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

  // История заказов клиента: лёгкий select только полей, которые рендерит
  // карточка (id/number/type/status/address/mytkoStatus), не больше 20
  const [clientOrders, messages] = await Promise.all([
    order.externalUserId
      ? db.order.findMany({
          where: { botId: id, externalUserId: order.externalUserId },
          select: {
            id: true,
            number: true,
            type: true,
            status: true,
            address: true,
            city: true,
            mytkoStatus: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
      : Promise.resolve([]),
    db.message.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      take: 300,
    }).then((rows) => rows.reverse()),
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

    // IMP-BE22-09: матрица переходов статусов. Из финальных (completed/cancelled)
    // — только с force (?force=1 или body.force); completedAt ставится только при
    // переходе в completed и НЕ сбрасывается обратно (раньше затирался null'ом).
    if (typeof body.status === 'string' && body.status) {
      const force = body.force === true || req.nextUrl.searchParams.get('force') === '1';
      const check = checkStatusTransition(order.status, body.status, force);
      if (!check.ok) {
        return NextResponse.json(
          { error: check.error ?? 'Недопустимый переход статуса' },
          { status: 400 }
        );
      }
      if (body.status !== order.status) {
        data.status = body.status;
        if (body.status === 'completed') data.completedAt = new Date();
      }
    }
    if (typeof body.assignee === 'string') data.assignee = body.assignee.trim().slice(0, 120) || null;
    if (typeof body.comment === 'string') data.comment = body.comment.trim().slice(0, 1000) || null;
    // IMP-24-BE-12: wishDate пишется вместе с разобранной датой pickupAt
    // («завтра до 12:00» → wishDate + pickupAt = полдень завтрашнего дня в UTC)
    if (typeof body.wishDate === 'string') {
      const wish = body.wishDate.trim().slice(0, 60) || null;
      data.wishDate = wish;
      data.pickupAt = wish ? parseWishDate(wish).date : null;
    }
    // IMP-25-06: явная дата забора — ISO-строка или 'YYYY-MM-DD'; null/пустая строка — очистить.
    // Для date-only время — дефолт парсера (полдень MSK в UTC, moscowNoonUTC);
    // обработка ПОСЛЕ wishDate — явный pickupAt сильнее производного из wishDate.
    if (body.pickupAt !== undefined) {
      if (body.pickupAt === null) {
        data.pickupAt = null;
      } else if (typeof body.pickupAt === 'string') {
        const s = body.pickupAt.trim();
        if (!s) {
          data.pickupAt = null;
        } else {
          const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
          const value = ymd
            ? moscowNoonUTC(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]))
            : new Date(s);
          if (!value || Number.isNaN(value.getTime())) {
            return NextResponse.json(
              { error: 'Некорректный pickupAt: ожидается ISO-дата или YYYY-MM-DD' },
              { status: 400 }
            );
          }
          data.pickupAt = value;
        }
      } else {
        return NextResponse.json(
          { error: 'Некорректный pickupAt: ожидается ISO-дата, YYYY-MM-DD или null' },
          { status: 400 }
        );
      }
    }
    if (body.phone !== undefined) {
      // IMP-24-REV-2: null — очистить поле (редактор клиента шлёт null при очистке)
      // IMP-25-07: телефон нормализуется («+7 (900) 123-45-67» → «+79001234567»)
      data.phone = normalizePhone(typeof body.phone === 'string' ? body.phone : null);
    }
    if (body.clientName !== undefined) {
      data.clientName = typeof body.clientName === 'string' ? body.clientName.trim().slice(0, 120) || null : null;
    }
    if (typeof body.size === 'string') data.size = body.size.trim().slice(0, 200) || null;
    if (typeof body.address === 'string') data.address = body.address.trim().slice(0, 300) || null;
    if (body.city !== undefined) {
      data.city = typeof body.city === 'string' ? body.city.trim().slice(0, 120) || null : null;
    }

    // IMP-24-BE-10: привязка к КП реестра — код lk_code обязан существовать у бота,
    // вместе с ним сохраняется снимок адреса КП; null/'' — открепить оба поля
    if (body.areaLkCode !== undefined) {
      const lk = typeof body.areaLkCode === 'string' ? body.areaLkCode.trim() : '';
      if (lk) {
        const area = await db.mytkoArea.findFirst({ where: { botId: id, lkCode: lk } });
        if (!area) {
          return NextResponse.json({ error: 'КП с таким кодом нет в реестре бота' }, { status: 400 });
        }
        data.areaLkCode = lk;
        data.areaAddress = area.address;
      } else {
        data.areaLkCode = null;
        data.areaAddress = null;
      }
    }

    // IMP-24-BE-11: назначение экипажа (должен принадлежать этому боту); null/'' — снять
    if (body.crewId !== undefined) {
      const cid = typeof body.crewId === 'string' ? body.crewId.trim() : '';
      if (cid) {
        const crew = await db.crew.findFirst({ where: { id: cid, botId: id } });
        if (!crew) {
          return NextResponse.json({ error: 'Экипаж не найден' }, { status: 400 });
        }
        data.crewId = cid;
      } else {
        data.crewId = null;
      }
    }

    // IMP-26-02: lat/lng — валидация диапазонов (семантика эталона IMP-25-09/REV-8
    // у жалоб: тот же текст ошибки и 400). undefined — не менять; null = снять
    // точку (ветка ниже сохранена); нечисловое/NaN/вне диапазона → 400.
    const latValid =
      body.lat === undefined ||
      body.lat === null ||
      (typeof body.lat === 'number' && Number.isFinite(body.lat) && body.lat >= -90 && body.lat <= 90);
    const lngValid =
      body.lng === undefined ||
      body.lng === null ||
      (typeof body.lng === 'number' && Number.isFinite(body.lng) && body.lng >= -180 && body.lng <= 180);
    if (!latValid || !lngValid) {
      return NextResponse.json(
        { error: 'lat/lng — числа (lat −90…90, lng −180…180) или null' },
        { status: 400 }
      );
    }

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
    // IMP-23-BE-06/07: rev.city больше не содержит мусорный префикс
    // «городской округ …» (чистка в reverseGeocode); адрес собирается
    // composeAddress из ЧИСТОГО города.
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
        data.address = composeAddress(rev.city, rev.address) || rev.address;
        if (rev.city) data.city = rev.city;
      }
    }

    // Перегеокодировать адрес по требованию оператора.
    // Ручная точка не теряется: если адрес не нашёлся — прежние координаты остаются.
    // IMP-23-BE-06: запрос собирается с городом (geocodeOrderAddress) и force:true —
    // «перепроверить» обязано игнорировать кэш (и успех, и неудачу).
    let geoResult: { ok: boolean; lat?: number; lng?: number } | undefined;
    if (body.geocode === true) {
      const addr = (typeof data.address === 'string' ? data.address : order.address) ?? '';
      // Город: если оператор в этом же запросе поменял город — берём новый,
      // иначе прежний город заявки
      const cityForGeo =
        typeof data.city === 'string' && data.city ? data.city : order.city;
      // IMP-23-REV-2 (reviewer MINOR-2): без адреса НЕ геокодим голое имя города
      // (регресс к «тихая точка в центре города») — прежний no-op контракт восстановлен
      const query = addr ? geocodeOrderAddress(cityForGeo, addr) : null;
      const geo = query ? await geocodeAddress(query, { force: true }) : null;
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

    // IMP-24-REV-1: ответ PATCH содержит те же связи, что GET-карточка
    // (conversation/crew) + messagesCount — иначе фронт, заменяя order целиком,
    // теряет «Открыть диалог», tel экипажа, счётчик сообщений и т.п. до поллинга
    const updated = await db.order.update({
      where: { id: orderId },
      data,
      include: {
        conversation: {
          select: { id: true, contact: true, source: true, externalUserId: true, needsOperator: true },
        },
        crew: { select: { id: true, name: true, phone: true } },
        _count: { select: { messages: true } },
      },
    });
    const { _count, ...flat } = updated;
    return NextResponse.json({ order: { ...flat, messagesCount: _count.messages }, geo: geoResult });
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

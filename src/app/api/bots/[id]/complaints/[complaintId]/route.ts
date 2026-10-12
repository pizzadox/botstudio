import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { geocodeAddress } from '@/lib/orders'; // IMP-24-BE-15: координаты при записи адреса

/**
 * IMP-23-BE-02: карточка жалобы — PATCH (статус/описание, с IMP-24-BE-15 — ещё
 * адрес с геокодингом и привязка к КП) и DELETE.
 * Матрица статусов: любые переходы между new/in_review/resolved разрешены
 * (жалоба — лёгкая сущность, «возврат в работу» из resolved — нормальный сценарий).
 */

type Params = { params: Promise<{ id: string; complaintId: string }> };

const COMPLAINT_STATUSES = new Set(['new', 'in_review', 'resolved']);
const MAX_DESCRIPTION = 2000;

async function loadOwnedComplaint(req: NextRequest, botId: string, complaintId: string) {
  const user = await getSessionUser(req);
  if (!user) return { error: 'unauthorized' as const };
  const bot = await db.bot.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== user.id) return { error: 'notfound' as const };
  const complaint = await db.complaint.findUnique({ where: { id: complaintId } });
  if (!complaint || complaint.botId !== botId) return { error: 'notfound' as const };
  return { user, bot, complaint };
}

function complaintDto(c: {
  id: string;
  number: number;
  type: string;
  status: string;
  description: string;
  happenedAt: Date | null;
  contact: string | null;
  // IMP-24-BE-14: адрес/координаты инцидента + КП
  address: string | null;
  lat: number | null;
  lng: number | null;
  areaLkCode: string | null;
  areaAddress: string | null;
  // IMP-25-14: заявка, оформленная по жалобе (эскалация)
  orderId: string | null;
  source: string;
  createdAt: Date;
  conversationId: string | null;
}) {
  return {
    id: c.id,
    number: c.number,
    type: c.type,
    status: c.status,
    description: c.description,
    happenedAt: c.happenedAt ? c.happenedAt.toISOString() : null,
    contact: c.contact,
    address: c.address,
    lat: c.lat,
    lng: c.lng,
    areaLkCode: c.areaLkCode,
    areaAddress: c.areaAddress,
    orderId: c.orderId, // IMP-25-14
    source: c.source,
    createdAt: c.createdAt.toISOString(),
    conversationId: c.conversationId,
  };
}

/** Карточка жалобы (IMP-25-14): одиночный GET — тот же DTO, что PATCH/список */
export async function GET(req: NextRequest, { params }: Params) {
  const { id, complaintId } = await params;
  const loaded = await loadOwnedComplaint(req, id, complaintId);
  if ('error' in loaded) {
    return NextResponse.json(
      { error: loaded.error === 'unauthorized' ? 'Требуется авторизация' : 'Жалоба не найдена' },
      { status: loaded.error === 'unauthorized' ? 401 : 404 }
    );
  }
  const res = NextResponse.json({ item: complaintDto(loaded.complaint) });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/** Обновление жалобы: status, description, address (+гео-контроль), areaLkCode, orderId */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, complaintId } = await params;
  const loaded = await loadOwnedComplaint(req, id, complaintId);
  if ('error' in loaded) {
    return NextResponse.json(
      { error: loaded.error === 'unauthorized' ? 'Требуется авторизация' : 'Жалоба не найдена' },
      { status: loaded.error === 'unauthorized' ? 401 : 404 }
    );
  }

  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};

    // Матрица переходов: любые между new/in_review/resolved (в т.ч. no-op)
    if (typeof body.status === 'string' && body.status) {
      if (!COMPLAINT_STATUSES.has(body.status)) {
        return NextResponse.json(
          { error: 'status — один из new/in_review/resolved' },
          { status: 400 }
        );
      }
      data.status = body.status;
    }

    if (typeof body.description === 'string') {
      const description = body.description.trim();
      if (!description || description.length > MAX_DESCRIPTION) {
        return NextResponse.json(
          { error: `description — непустая строка до ${MAX_DESCRIPTION} символов` },
          { status: 400 }
        );
      }
      data.description = description;
    }

    // IMP-24-BE-15: адрес инцидента (непустой ≤ 300). Геокодинг решается ниже,
    // единым блоком гео-контроля (IMP-25-09) — с учётом ручной точки и geocode:true.
    let addressChanged = false;
    if (typeof body.address === 'string') {
      const address = body.address.trim().slice(0, 300);
      if (!address) {
        return NextResponse.json(
          { error: 'address — непустая строка до 300 символов' },
          { status: 400 }
        );
      }
      addressChanged = address !== loaded.complaint.address;
      data.address = address;
    }

    // IMP-24-BE-15: привязка к КП реестра — код обязан существовать у бота,
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

    // IMP-25-14: эскалация «жалоба → заявка» — orderId заявки ЭТОГО бота;
    // null/'' — отвязать. Заявка чужого бота/несуществующая → 400.
    if (body.orderId !== undefined) {
      const oid = typeof body.orderId === 'string' ? body.orderId.trim() : '';
      if (oid) {
        const order = await db.order.findFirst({ where: { id: oid, botId: id }, select: { id: true } });
        if (!order) {
          return NextResponse.json({ error: 'Заявка не найдена' }, { status: 400 });
        }
        data.orderId = order.id;
      } else {
        data.orderId = null;
      }
    }

    // IMP-25-09 (REV-8): ручная точка оператора — lat/lng с проверкой диапазона;
    // null — снять точку (как у заявок). geoSource у жалобы НЕТ — не пишем.
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
    if (body.lat !== undefined) data.lat = body.lat;
    if (body.lng !== undefined) data.lng = body.lng;

    // IMP-25-09 (REV-8): гео-контроль жалобы.
    //  1) geocode:true — принудительный перегеокод по ТЕКУЩЕМУ адресу (force,
    //     как у заявок: кэш игнорируется; неудача НЕ стирает существующую точку);
    //  2) адрес изменился — точка следует за адресом (перегеокод), независимо
    //     от того, были ли координаты раньше (раньше геокод молча пропускался
    //     при имеющихся координатах → точка расходилась с адресом);
    //  3) адрес НЕ менялся и geocode не запрошен — координаты не трогаем.
    //     Ручная точка (lat/lng в этом же запросе) старше автогеокода.
    const wantsGeocode = body.geocode === true;
    const manualPoint = body.lat !== undefined || body.lng !== undefined;
    const effectiveAddress =
      (typeof data.address === 'string' ? data.address : loaded.complaint.address) ?? '';
    if ((wantsGeocode || (addressChanged && !manualPoint)) && effectiveAddress) {
      try {
        const geo = await geocodeAddress(effectiveAddress, { force: wantsGeocode });
        if (geo) {
          data.lat = geo.lat;
          data.lng = geo.lng;
        } else if (wantsGeocode) {
          // как у заявок: неудачный поиск не сдвигает/не стирает точку
          delete data.lat;
          delete data.lng;
        }
      } catch {
        // геокодинг недоступен — пишем только адрес (точку поставит оператор)
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        {
          error:
            'Нечего обновлять: передайте status, description, address, areaLkCode, orderId, lat/lng и/или geocode',
        },
        { status: 400 }
      );
    }

    const updated = await db.complaint.update({ where: { id: complaintId }, data });
    return NextResponse.json({ item: complaintDto(updated) });
  } catch (err) {
    console.error('[complaints patch]', err);
    return NextResponse.json({ error: 'Не удалось обновить жалобу' }, { status: 500 });
  }
}

/** Удаление жалобы */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, complaintId } = await params;
  const loaded = await loadOwnedComplaint(req, id, complaintId);
  if ('error' in loaded) {
    return NextResponse.json(
      { error: loaded.error === 'unauthorized' ? 'Требуется авторизация' : 'Жалоба не найдена' },
      { status: loaded.error === 'unauthorized' ? 401 : 404 }
    );
  }
  await db.complaint.delete({ where: { id: complaintId } });
  return NextResponse.json({ ok: true });
}

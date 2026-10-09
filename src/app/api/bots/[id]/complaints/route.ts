import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * IMP-23-BE-02: реестр жалоб бота.
 * Жалобы создаются сценарием бота (узел «Сообщение» с флагом createComplaint,
 * source='scenario') или оператором вручную (source='manual', POST ниже).
 * Типы: no_pickup (не вывезли) / damaged (повреждён контейнер) /
 * overflow (переполнена площадка) / other. Статусы: new / in_review / resolved.
 */

type Params = { params: Promise<{ id: string }> };

const COMPLAINT_TYPES = new Set(['no_pickup', 'damaged', 'overflow', 'other']);
const COMPLAINT_STATUSES = new Set(['new', 'in_review', 'resolved']);
const MAX_TAKE = 500;
const DEFAULT_TAKE = 100;
const MAX_DESCRIPTION = 2000;

/** ComplaintDto — контракт с фронтом (закреплён в волне 23; IMP-24-BE-14 — гео-поля; IMP-25-14 — orderId) */
function toDto(c: {
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

async function loadOwnedBot(req: NextRequest, botId: string) {
  const user = await getSessionUser(req);
  if (!user) return { error: 'unauthorized' as const };
  const bot = await db.bot.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== user.id) return { error: 'notfound' as const };
  return { user, bot };
}

/**
 * Список жалоб: фильтры ?status= ?type= ?conversationId= (IMP-25-16 —
 * панель инбокса «жалобы клиента»; при фильтре дефолтный take = 10),
 * пагинация курсором по (createdAt, id) — стабильна при вставках между
 * страницами (в отличие от offset).
 * counts — группировка по status БЕЗ фильтров (бейджи навигации).
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const loaded = await loadOwnedBot(req, id);
  if ('error' in loaded) {
    return NextResponse.json(
      { error: loaded.error === 'unauthorized' ? 'Требуется авторизация' : 'Бот не найден' },
      { status: loaded.error === 'unauthorized' ? 401 : 404 }
    );
  }

  const sp = req.nextUrl.searchParams;

  const statusParam = sp.get('status');
  if (statusParam && !COMPLAINT_STATUSES.has(statusParam)) {
    return NextResponse.json(
      { error: 'status — один из new/in_review/resolved' },
      { status: 400 }
    );
  }
  const typeParam = sp.get('type');
  if (typeParam && !COMPLAINT_TYPES.has(typeParam)) {
    return NextResponse.json(
      { error: 'type — один из no_pickup/damaged/overflow/other' },
      { status: 400 }
    );
  }
  // IMP-25-16: фильтр по диалогу (панель инбокса «жалобы клиента»);
  // дефолтный take для этого режима — 10 (явный ?take= по-прежнему работает)
  const conversationFilter = (sp.get('conversationId') ?? '').trim() || null;

  const takeParam = Number(sp.get('take') ?? '');
  const take =
    Number.isFinite(takeParam) && takeParam > 0
      ? Math.min(Math.floor(takeParam), MAX_TAKE)
      : conversationFilter
        ? 10 // IMP-25-16
        : DEFAULT_TAKE;

  // Курсор: id последней жалобы предыдущей страницы; ищем строки СТРОГО «до» неё
  // по (createdAt, id) — надёжно при равных createdAt (SQLite хранит мс).
  const cursorId = sp.get('cursor');
  let cursor: { id: string; createdAt: Date } | null = null;
  if (cursorId) {
    const row = await db.complaint.findUnique({
      where: { id: cursorId },
      select: { id: true, createdAt: true, botId: true },
    });
    if (!row || row.botId !== id) {
      return NextResponse.json({ error: 'Некорректный курсор' }, { status: 400 });
    }
    cursor = { id: row.id, createdAt: row.createdAt };
  }

  const where = {
    botId: id,
    ...(statusParam ? { status: statusParam } : {}),
    ...(typeParam ? { type: typeParam } : {}),
    ...(conversationFilter ? { conversationId: conversationFilter } : {}), // IMP-25-16
    ...(cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }
      : {}),
  };

  const [rows, grouped, total] = await Promise.all([
    db.complaint.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1, // +1 — определить наличие следующей страницы
    }),
    db.complaint.groupBy({ by: ['status'], where: { botId: id }, _count: { _all: true } }),
    db.complaint.count({ where: { botId: id } }),
  ]);

  const hasMore = rows.length > take;
  const items = (hasMore ? rows.slice(0, take) : rows).map(toDto);
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

  const counts = { total, new: 0, inReview: 0, resolved: 0 };
  for (const g of grouped) {
    const n = g._count._all;
    if (g.status === 'new') counts.new = n;
    else if (g.status === 'in_review') counts.inReview = n;
    else if (g.status === 'resolved') counts.resolved = n;
  }

  const res = NextResponse.json({ items, nextCursor, counts });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/** Ручное создание жалобы оператором (source='manual') */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const loaded = await loadOwnedBot(req, id);
  if ('error' in loaded) {
    return NextResponse.json(
      { error: loaded.error === 'unauthorized' ? 'Требуется авторизация' : 'Бот не найден' },
      { status: loaded.error === 'unauthorized' ? 401 : 404 }
    );
  }

  try {
    const body = await req.json();

    const type = typeof body.type === 'string' && COMPLAINT_TYPES.has(body.type) ? body.type : null;
    if (!type) {
      return NextResponse.json(
        { error: 'type обязателен: no_pickup | damaged | overflow | other' },
        { status: 400 }
      );
    }
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!description || description.length > MAX_DESCRIPTION) {
      return NextResponse.json(
        { error: `description обязателен (1–${MAX_DESCRIPTION} символов)` },
        { status: 400 }
      );
    }
    if (typeof body.status === 'string' && !COMPLAINT_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: 'status — один из new/in_review/resolved' },
        { status: 400 }
      );
    }
    const status =
      typeof body.status === 'string' && COMPLAINT_STATUSES.has(body.status) ? body.status : 'new';

    let happenedAt: Date | null = null;
    if (body.happenedAt !== undefined && body.happenedAt !== null && body.happenedAt !== '') {
      const d = new Date(String(body.happenedAt));
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'happenedAt — некорректная дата' }, { status: 400 });
      }
      happenedAt = d;
    }

    // conversationId — если указан, должен принадлежать этому боту;
    // IMP-25-14: контакт не теряется — если контакт не передан явно,
    // берём его из диалога (жалоба остаётся связанной с клиентом)
    let conversationId: string | null = null;
    let conversationContact: string | null = null;
    if (typeof body.conversationId === 'string' && body.conversationId.trim()) {
      const conv = await db.conversation.findUnique({
        where: { id: body.conversationId.trim() },
        select: { id: true, botId: true, contact: true },
      });
      if (!conv || conv.botId !== id) {
        return NextResponse.json({ error: 'Диалог не найден' }, { status: 400 });
      }
      conversationId = conv.id;
      conversationContact = conv.contact;
    }

    // IMP-24-BE-14: адрес инцидента (≤ 300, опционально) и координаты (если переданы)
    const address =
      typeof body.address === 'string' ? body.address.trim().slice(0, 300) || null : null;
    const lat = typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : null;
    const lng = typeof body.lng === 'number' && Number.isFinite(body.lng) ? body.lng : null;

    // IMP-23-REV-1 (reviewer MAJOR-1): number = max+1 может столкнуться при гонке
    // (два оператора / оператор+сценарий) — ретрай до 3 раз по паттерну движка.
    const agg = await db.complaint.aggregate({ where: { botId: id }, _max: { number: true } });
    const base = agg._max.number ?? 0;

    let item: Awaited<ReturnType<typeof db.complaint.create>> | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        item = await db.complaint.create({
          data: {
            botId: id,
            number: base + 1 + attempt,
            type,
            status,
            description: description.slice(0, MAX_DESCRIPTION),
            happenedAt,
            // IMP-25-14: contact не перетирается — явный непустой contact приоритетен,
            // иначе контакт диалога (если тот задан)
            contact:
              (typeof body.contact === 'string'
                ? body.contact.trim().slice(0, 200) || null
                : null) || conversationContact,
            // IMP-24-BE-14: гео-контекст ручной жалобы
            address,
            lat,
            lng,
            conversationId,
            source: 'manual',
          },
        });
        break;
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === 'P2002' && attempt < 2) continue; // unique(botId, number) — берём следующий номер
        throw e;
      }
    }
    if (!item) {
      return NextResponse.json({ error: 'Не удалось создать жалобу' }, { status: 500 });
    }

    return NextResponse.json({ item: toDto(item) }, { status: 201 });
  } catch (err) {
    console.error('[complaints create]', err);
    return NextResponse.json({ error: 'Не удалось создать жалобу' }, { status: 500 });
  }
}

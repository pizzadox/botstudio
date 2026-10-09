import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit'; // IMP-26-03: лимит на выгрузку CSV
import { ORDER_STATUS_LABELS, ORDER_TYPE_LABELS } from '@/lib/orders';
import { ORDER_STATUSES } from '@/lib/order-status';

type Params = { params: Promise<{ id: string }> };

/** Колонки CSV — фикс. порядок (IMP-BE22-07; IMP-25-03: + экипаж/КП/дата забора) */
const HEADERS = [
  'Номер',
  'Тип',
  'Статус',
  'Клиент',
  'Телефон',
  'Город',
  'Адрес',
  'Размер',
  'Желаемая дата',
  'Дата забора',
  'Комментарий',
  'Экипаж',
  'Телефон экипажа',
  'КП (код)',
  'КП (адрес)',
  'Создана',
  'Обновлена',
] as const;

/**
 * Экранирование значения CSV: если есть кавычки/запятые/переносы —
 * оборачиваем в кавычки и удваиваем внутренние.
 * IMP-25-03: защита от CSV-инъекции — значение, начинающееся на = + - @ TAB,
 * префиксуем апострофом (Excel/LibreOffice не исполнит его как формулу).
 */
function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return /["\r\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// IMP-25-03: все даты CSV — в Europe/Moscow (+3, без DST), а не в UTC сервера;
// формат прежний Excel-дружелюбный «YYYY-MM-DD HH:mm»
const MSK_DATETIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Дата для CSV: «2026-10-08 11:30» (Europe/Moscow) — Excel-дружелюбный формат */
function csvDate(d: Date | null | undefined): string {
  if (!d) return '';
  const parts = MSK_DATETIME.formatToParts(new Date(d));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** CSV-выгрузка заявок бота. GET ?status=&from=&to= → text/csv (UTF-8 + BOM для Excel). */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  // IMP-26-03: выгрузка дорогая (цикл батчей по курсору) — не больше 5 CSV
  // с одного пользователя в минуту (паттерн rateLimit демо-роута)
  if (!rateLimit(`csv:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Слишком много запросов' }, { status: 429 });
  }

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  const sp = req.nextUrl.searchParams;

  // Фильтры: status — точное совпадение (IMP-25-03: тот же параметр, что в GET-списке
  // заявок — выгрузка уважает активный фильтр раздела); from/to — диапазон createdAt.
  const where: {
    botId: string;
    status?: string;
    type?: string;
    crewId?: string | null;
    createdAt?: { gte?: Date; lt?: Date };
  } = {
    botId: id,
  };

  const status = sp.get('status');
  if (status) {
    if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: 'Неизвестный статус' }, { status: 400 });
    }
    where.status = status;
  }

  // IMP-25-REV-8: экспорт уважает фильтры типа и экипажа (как на фронте)
  const typeParam = sp.get('type');
  if (typeParam) {
    if (!(typeParam in ORDER_TYPE_LABELS)) {
      return NextResponse.json({ error: 'Неизвестный тип заявки' }, { status: 400 });
    }
    where.type = typeParam;
  }
  const crewNone = sp.get('crew') === 'none';
  const crewIdParam = sp.get('crewId');
  if (crewNone) where.crewId = null;
  else if (crewIdParam) where.crewId = crewIdParam;

  const createdAt: { gte?: Date; lt?: Date } = {};
  const fromParam = sp.get('from');
  if (fromParam) {
    const d = new Date(fromParam);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'Некорректная дата from' }, { status: 400 });
    }
    createdAt.gte = d;
  }
  const toParam = sp.get('to');
  if (toParam) {
    const d = new Date(toParam);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'Некорректная дата to' }, { status: 400 });
    }
    // Дата без времени (YYYY-MM-DD) — включаем весь день
    if (/^\d{4}-\d{2}-\d{2}$/.test(toParam.trim())) d.setUTCHours(24, 0, 0, 0);
    createdAt.lt = d;
  }
  if (createdAt.gte || createdAt.lt) where.createdAt = createdAt;

  // Те же поля, что у GET /api/bots/[id]/orders (без гео/mytko — в CSV не нужны);
  // IMP-25-03: + экипаж (name/phone), КП (код/адрес) и дата забора pickupAt.
  // IMP-26-03: один take:5000 заменён циклом батчей по курсору (take 500,
  // orderBy с id-tiebreaker, cursor от последней строки) — большие таблицы
  // больше не выгружаются одним тяжёлым запросом. Потолок 5000 сохранён —
  // выгрузка не должна становиться «дампом таблицы»; при достижении капа
  // и наличии строк за последней выгруженной — заголовок X-Truncated: 1.
  const BATCH_SIZE = 500;
  const EXPORT_CAP = 5000;
  const rows: string[] = [HEADERS.map(csvCell).join(',')];
  let cursorId: string | null = null;
  let lastAddedId: string | null = null;
  let total = 0;
  let truncated = false;
  for (;;) {
    const batch = await db.order.findMany({
      where,
      select: {
        id: true, // IMP-26-03: поле курсора (в CSV не попадает)
        number: true,
        type: true,
        status: true,
        clientName: true,
        phone: true,
        city: true,
        address: true,
        size: true,
        wishDate: true,
        pickupAt: true,
        comment: true,
        crew: { select: { name: true, phone: true } },
        areaLkCode: true,
        areaAddress: true,
        createdAt: true,
        updatedAt: true,
      },
      // id — детерминированный tiebreaker: стабильный порядок при равных createdAt
      // обязателен для курсорной пагинации
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: BATCH_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;
    for (const o of batch) {
      rows.push(
        [
          o.number,
          ORDER_TYPE_LABELS[o.type] ?? o.type,
          ORDER_STATUS_LABELS[o.status] ?? o.status,
          o.clientName,
          o.phone,
          o.city,
          o.address,
          o.size,
          o.wishDate,
          csvDate(o.pickupAt),
          o.comment,
          o.crew?.name ?? null,
          o.crew?.phone ?? null,
          o.areaLkCode,
          o.areaAddress,
          csvDate(o.createdAt),
          csvDate(o.updatedAt),
        ]
          .map(csvCell)
          .join(',')
      );
      lastAddedId = o.id;
      if (++total >= EXPORT_CAP) break;
    }
    if (total >= EXPORT_CAP && lastAddedId) {
      // Кап достигнут: X-Truncated ставим только если за последней строкой
      // есть ещё данные (ровно 5000 строк всего — НЕ усечение)
      const more = await db.order.findMany({
        where,
        select: { id: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        cursor: { id: lastAddedId },
        skip: 1,
        take: 1,
      });
      truncated = more.length > 0;
      break;
    }
    if (batch.length < BATCH_SIZE) break; // данные кончились
    cursorId = batch[batch.length - 1].id;
  }

  // BOM (\uFEFF) — чтобы Excel корректно открыл UTF-8 с кириллицей
  const csv = '\uFEFF' + rows.join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);

  // IMP-26-03: контракт blob'а для фронта (orders-view exportCsv) сохранён:
  // Content-Disposition/BOM/Cache-Control без изменений; X-Truncated —
  // аддитивный заголовок, ставится только при усечении капом
  const headers: Record<string, string> = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="orders-${stamp}.csv"`,
    'Cache-Control': 'no-store',
  };
  if (truncated) headers['X-Truncated'] = '1';
  return new NextResponse(csv, { status: 200, headers });
}

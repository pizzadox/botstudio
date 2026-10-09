import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
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
  // IMP-25-03: + экипаж (name/phone), КП (код/адрес) и дата забора pickupAt;
  // потолок 5000 строк — выгрузка не должна становиться «дампом таблицы».
  const orders = await db.order.findMany({
    where,
    select: {
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
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });

  const rows: string[] = [HEADERS.map(csvCell).join(',')];
  for (const o of orders) {
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
  }

  // BOM (\uFEFF) — чтобы Excel корректно открыл UTF-8 с кириллицей
  const csv = '\uFEFF' + rows.join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="orders-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

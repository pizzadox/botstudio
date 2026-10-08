import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { ORDER_STATUS_LABELS, ORDER_TYPE_LABELS } from '@/lib/orders';
import { ORDER_STATUSES } from '@/lib/order-status';

type Params = { params: Promise<{ id: string }> };

/** Колонки CSV — фикс. порядок (IMP-BE22-07) */
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
  'Комментарий',
  'Создана',
  'Обновлена',
] as const;

/**
 * Экранирование значения CSV: если есть кавычки/запятые/переносы —
 * оборачиваем в кавычки и удваиваем внутренние.
 */
function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /["\r\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Дата для CSV: «2026-10-08 08:30» (UTC) — Excel-дружелюбный формат */
function csvDate(d: Date | null | undefined): string {
  if (!d) return '';
  const iso = new Date(d).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
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

  // Фильтры: status — точное совпадение; from/to — диапазон createdAt.
  const where: { botId: string; status?: string; createdAt?: { gte?: Date; lt?: Date } } = {
    botId: id,
  };

  const status = sp.get('status');
  if (status) {
    if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: 'Неизвестный статус' }, { status: 400 });
    }
    where.status = status;
  }

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
      comment: true,
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
        o.comment,
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

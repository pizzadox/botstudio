import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import type { CrewDto } from '@/lib/studio-types';

/**
 * IMP-24-BE-17: справочник экипажей (бригад) бота.
 * GET  — список (сначала активные, затем по имени) с числом закреплённых заявок;
 * POST — создание: name 1..120 обязателен, phone ≤ 20, notes ≤ 300 (trim).
 * Назначение экипажа на заявку — PATCH /api/bots/[id]/orders/[orderId] ({crewId}).
 */

type Params = { params: Promise<{ id: string }> };

const MAX_NAME = 120;
const MAX_PHONE = 20;
const MAX_NOTES = 300;

/** CrewDto — контракт с фронтом (studio-types) */
function toDto(c: {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  active: boolean;
  createdAt: Date;
  _count?: { orders: number };
}): CrewDto {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    notes: c.notes,
    active: c.active,
    ordersCount: c._count?.orders ?? 0,
    createdAt: c.createdAt.toISOString(),
  };
}

async function loadOwnedBot(req: NextRequest, botId: string) {
  const user = await getSessionUser(req);
  if (!user) return { error: 'unauthorized' as const };
  const bot = await db.bot.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== user.id) return { error: 'notfound' as const };
  return { user, bot };
}

/** Список экипажей бота (активные сверху, внутри — по имени) */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const loaded = await loadOwnedBot(req, id);
  if ('error' in loaded) {
    return NextResponse.json(
      { error: loaded.error === 'unauthorized' ? 'Требуется авторизация' : 'Бот не найден' },
      { status: loaded.error === 'unauthorized' ? 401 : 404 }
    );
  }

  const crews = await db.crew.findMany({
    where: { botId: id },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { orders: true } } },
  });

  const res = NextResponse.json({ items: crews.map(toDto) });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/** Создать экипаж */
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
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
    if (!name) {
      return NextResponse.json(
        { error: `name обязателен (1–${MAX_NAME} символов)` },
        { status: 400 }
      );
    }
    const phone =
      typeof body.phone === 'string' ? body.phone.trim().slice(0, MAX_PHONE) || null : null;
    const notes =
      typeof body.notes === 'string' ? body.notes.trim().slice(0, MAX_NOTES) || null : null;

    const crew = await db.crew.create({ data: { botId: id, name, phone, notes } });
    return NextResponse.json({ crew: toDto(crew) }, { status: 201 });
  } catch (err) {
    console.error('[crews create]', err);
    return NextResponse.json({ error: 'Не удалось создать экипаж' }, { status: 500 });
  }
}

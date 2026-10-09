import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { normalizePhone } from '@/lib/orders'; // IMP-25-07: нормализация телефона экипажа
import type { CrewDto } from '@/lib/studio-types';

/**
 * IMP-24-BE-18: карточка экипажа — PATCH (частичное обновление name/phone/notes/active)
 * и DELETE. Удаление отвязывает заявки автоматически (Order.crewId onDelete: SetNull).
 * Экипаж обязателен принадлежащий этому боту — иначе 404.
 */

type Params = { params: Promise<{ id: string; crewId: string }> };

const MAX_NAME = 120;
const MAX_PHONE = 20;
const MAX_NOTES = 300;

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

async function loadOwnedCrew(req: NextRequest, botId: string, crewId: string) {
  const user = await getSessionUser(req);
  if (!user) return { error: 'unauthorized' as const };
  const bot = await db.bot.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== user.id) return { error: 'notfound' as const };
  const crew = await db.crew.findUnique({ where: { id: crewId } });
  if (!crew || crew.botId !== botId) return { error: 'notfound' as const };
  return { user, bot, crew };
}

/** Обновить экипаж (любое сочетание полей; пустое тело — 400) */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, crewId } = await params;
  const loaded = await loadOwnedCrew(req, id, crewId);
  if ('error' in loaded) {
    return NextResponse.json(
      { error: loaded.error === 'unauthorized' ? 'Требуется авторизация' : 'Экипаж не найден' },
      { status: loaded.error === 'unauthorized' ? 401 : 404 }
    );
  }

  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};

    if (typeof body.name === 'string') {
      const name = body.name.trim().slice(0, MAX_NAME);
      if (!name) {
        return NextResponse.json(
          { error: `name — непустая строка до ${MAX_NAME} символов` },
          { status: 400 }
        );
      }
      data.name = name;
    }
    if (body.phone !== undefined) {
      // IMP-24-REV-2: null — очистить телефон (инлайн-редактор справочника шлёт null)
      // IMP-25-07: телефон нормализуется (раньше сохранялся «как есть» — только trim/лимит)
      data.phone = normalizePhone(typeof body.phone === 'string' ? body.phone : null);
    }
    if (body.notes !== undefined) {
      data.notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, MAX_NOTES) || null : null;
    }
    if (typeof body.active === 'boolean') data.active = body.active;

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'Нечего обновлять: передайте name/phone/notes и/или active' },
        { status: 400 }
      );
    }

    const updated = await db.crew.update({
      where: { id: crewId },
      data,
      include: { _count: { select: { orders: true } } },
    });
    return NextResponse.json({ crew: toDto(updated) });
  } catch (err) {
    console.error('[crews patch]', err);
    return NextResponse.json({ error: 'Не удалось обновить экипаж' }, { status: 500 });
  }
}

/** Удалить экипаж (заявки остаются, crewId у них сбрасывается в null на уровне схемы) */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, crewId } = await params;
  const loaded = await loadOwnedCrew(req, id, crewId);
  if ('error' in loaded) {
    return NextResponse.json(
      { error: loaded.error === 'unauthorized' ? 'Требуется авторизация' : 'Экипаж не найден' },
      { status: loaded.error === 'unauthorized' ? 401 : 404 }
    );
  }
  await db.crew.delete({ where: { id: crewId } });
  return NextResponse.json({ ok: true });
}

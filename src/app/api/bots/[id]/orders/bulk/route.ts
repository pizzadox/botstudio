import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { checkStatusTransition, ORDER_STATUSES } from '@/lib/order-status';

type Params = { params: Promise<{ id: string }> };

/** Потолок пачки — защита от гигантских payload'ов */
const MAX_IDS = 1000;

/**
 * Массовое изменение статуса заявок (22-BE2, IMP-BE22-09) + назначение экипажа (IMP-25-05).
 * POST { ids: string[], status?, force?, crewId?: string | null }
 *   → { ok, updated, skipped, crewUpdated? }
 *  - та же матрица переходов, что в PATCH заявки (при переданном status);
 *  - финальные (completed/cancelled) без force пропускаются (skipped);
 *  - completedAt ставится только при переходе в completed, обратно не сбрасывается;
 *  - crewId (опционально): непустая строка — экипаж существует и принадлежит боту
 *    (та же валидация, что в PATCH карточки), null — снять экипаж; применяется ко ВСЕМ
 *    найденным заявкам бота независимо от статуса (счётчик — crewUpdated).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  try {
    const body = (await req.json().catch(() => null)) as
      | { ids?: unknown; status?: unknown; force?: unknown; crewId?: unknown }
      | null;

    const rawIds: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
    const ids = [...new Set(rawIds.filter((x): x is string => typeof x === 'string' && !!x))];
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Укажите ids заявок' }, { status: 400 });
    }
    if (ids.length > MAX_IDS) {
      return NextResponse.json({ error: `Не больше ${MAX_IDS} заявок за раз` }, { status: 400 });
    }

    // IMP-25-05: действие — статус и/или экипаж (хотя бы одно)
    const status = typeof body?.status === 'string' ? body.status : '';
    const hasStatus = status.length > 0;
    const hasCrew = body?.crewId !== undefined;
    if (!hasStatus && !hasCrew) {
      return NextResponse.json({ error: 'Укажите status и/или crewId' }, { status: 400 });
    }
    if (hasStatus && !(ORDER_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: 'Неизвестный статус' }, { status: 400 });
    }

    // IMP-25-05: валидация crewId как в PATCH карточки — экипаж существует и принадлежит боту;
    // null (или пустая строка) — снять экипаж
    let crewIdValue: string | null = null;
    if (hasCrew) {
      const cid = typeof body?.crewId === 'string' ? body.crewId.trim() : '';
      if (cid) {
        const crew = await db.crew.findFirst({ where: { id: cid, botId: id } });
        if (!crew) {
          return NextResponse.json({ error: 'Экипаж не найден' }, { status: 400 });
        }
        crewIdValue = cid;
      }
    }

    const force = body?.force === true || req.nextUrl.searchParams.get('force') === '1';

    // Владелец уже проверен — выбираем только заявки этого бота из пачки
    const orders = await db.order.findMany({
      where: { id: { in: ids }, botId: id },
      select: { id: true, status: true },
    });

    const eligible: string[] = [];
    let skipped = ids.length - orders.length; // не найдены / чужие
    if (hasStatus) {
      for (const o of orders) {
        const check = checkStatusTransition(o.status, status, force);
        if (check.ok) eligible.push(o.id);
        else skipped += 1;
      }
    }

    let updated = 0;
    if (hasStatus && eligible.length > 0) {
      const result = await db.order.updateMany({
        where: { id: { in: eligible }, botId: id },
        data: {
          status,
          // completedAt — только при переходе в completed; при отмене/переоткрытии не трогаем
          ...(status === 'completed' ? { completedAt: new Date() } : {}),
        },
      });
      updated = result.count;
    }

    // IMP-25-05: экипаж применяется ко всем найденным заявкам бота независимо от статуса
    // (закрепить экипаж за уже выполненной заявкой — легитимно); skip/force касается только статуса
    let crewUpdated = 0;
    if (hasCrew) {
      const result = await db.order.updateMany({
        where: { id: { in: orders.map((o) => o.id) }, botId: id },
        data: { crewId: crewIdValue },
      });
      crewUpdated = result.count;
    }

    return NextResponse.json({
      ok: true,
      updated,
      skipped,
      // поле добавляется только когда crewId был в запросе — обратная совместимость ответа
      ...(hasCrew ? { crewUpdated } : {}),
    });
  } catch (err) {
    console.error('[orders bulk]', err);
    return NextResponse.json({ error: 'Не удалось обновить заявки' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { normalizeCityName } from '@/lib/orders';
import { FINAL_ORDER_STATUSES } from '@/lib/order-status';
import type {
  CrewAutoAssignPlanItem,
  CrewAutoAssignResult,
  CrewAutoAssignUnmatched,
} from '@/lib/studio-types';

type Params = { params: Promise<{ id: string }> };

/** IMP-26-05: потолок заявок в одной обработке автоназначения (честный ответ по нему) */
const ORDERS_CAP = 2000;

/**
 * IMP-26-05: автоназначение заявок экипажам по городу.
 *
 * POST /api/bots/[id]/crews/auto-assign
 *   body: { dryRun?: boolean, onlyUnassigned?: boolean }
 *   - dryRun по умолчанию TRUE (безопасный дефолт): возвращается только план;
 *     запись возможна ТОЛЬКО при явном dryRun:false.
 *   - onlyUnassigned (default true): обрабатывать только заявки без экипажа —
 *     уже назначенные не перетираются; при false — заявки с экипажем тоже
 *     участвуют (переназначение), финальные статусы исключены всегда.
 *
 * Ответ: CrewAutoAssignResult (studio-types):
 *   { assigned?: number, plan: [{crewId, crewName, city, count, orderIds[]}], unmatched: [{city, count}] }
 * - Матч ТОЧНЫЙ: normalizeCityName(crew.city) === normalizeCityName(order.city)
 *   (trim/lowercase/ё→е/срез «городской|муниципальный округ»).
 * - Несколько экипажей на один город — первый по name asc (детерминизм).
 * - assigned — сумма РЕАЛЬНО обновлённых строк (updateMany count), а не план.
 * - Аддитивный контракт: при упоре в ORDERS_CAP (2000) ставится заголовок
 *   X-Truncated: 1 — план покрывает только первые 2000 заявок (createdAt desc).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  // Паттерн auth как в crews/route.ts: бот обязан принадлежать пользователю
  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  let body: { dryRun?: unknown; onlyUnassigned?: unknown } = {};
  try {
    body = (await req.json()) as { dryRun?: unknown; onlyUnassigned?: unknown };
  } catch {
    body = {}; // пустое/некорректное тело — безопасные дефолты (dryRun-план)
  }

  // Безопасный дефолт: ПЛАН без записи; применение — только явный dryRun:false
  const dryRun = body.dryRun !== false;
  const onlyUnassigned = body.onlyUnassigned !== false; // default true

  // Заявки-кандидаты: с городом, не в финальном статусе; по умолчанию —
  // только без экипажа. IMP-26-REV-1: peek take ORDERS_CAP+1 — кап считаем
  // достигнутым только если ЕСТЬ данные за лимитом (ровно 2000 — не усечение).
  const ordersAll = await db.order.findMany({
    where: {
      botId: id,
      city: { not: null },
      status: { notIn: [...FINAL_ORDER_STATUSES] },
      ...(onlyUnassigned ? { crewId: null } : {}),
    },
    select: { id: true, city: true },
    orderBy: { createdAt: 'desc' },
    take: ORDERS_CAP + 1,
  });
  const orders = ordersAll.slice(0, ORDERS_CAP);
  // IMP-26-05: cap достигнут — сигнализируем заголовком (аддитивно к контракту),
  // т.к. CrewAutoAssignResult не имеет поля для усечения
  const capped = ordersAll.length > ORDERS_CAP;

  // Активные экипажи с городом; name asc — детерминированный порядок
  const crews = await db.crew.findMany({
    where: { botId: id, active: true, city: { not: null } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, city: true },
  });

  // Первый экипаж на каждый нормализованный город (name asc выше)
  const crewByCity = new Map<string, { id: string; name: string }>();
  for (const c of crews) {
    if (!c.city) continue; // страховка (where уже отсёк)
    const key = normalizeCityName(c.city);
    if (key && !crewByCity.has(key)) crewByCity.set(key, { id: c.id, name: c.name });
  }

  // Группировка заявок по нормализованному городу (порядок внутри группы —
  // createdAt desc, как в выборке)
  const planByCrew = new Map<string, CrewAutoAssignPlanItem>();
  const unmatched = new Map<string, CrewAutoAssignUnmatched>();
  for (const o of orders) {
    const rawCity = o.city;
    if (!rawCity) continue;
    const key = normalizeCityName(rawCity);
    const crew = key ? crewByCity.get(key) : undefined;
    if (!crew) {
      // Нет активного экипажа с таким городом. IMP-26-REV-2: группируем по
      // нормализованному ключу, но показываем СЫРОЙ город (первый встретившийся)
      const display = rawCity.trim().slice(0, 120) || key;
      if (!display) continue;
      const u = unmatched.get(key || display);
      if (u) u.count += 1;
      else unmatched.set(key || display, { city: display, count: 1 });
      continue;
    }
    const item = planByCrew.get(crew.id);
    if (item) {
      item.count += 1;
      item.orderIds.push(o.id);
    } else {
      planByCrew.set(crew.id, {
        crewId: crew.id,
        crewName: crew.name,
        // IMP-26-REV-2: сырой город заявки для отображения (матч — по нормализованному)
        city: rawCity.trim().slice(0, 120) || key,
        count: 1,
        orderIds: [o.id],
      });
    }
  }

  const plan = [...planByCrew.values()];
  const unmatchedList = [...unmatched.values()];

  if (dryRun) {
    const res = NextResponse.json({
      plan,
      unmatched: unmatchedList,
    } satisfies CrewAutoAssignResult);
    if (capped) res.headers.set('X-Truncated', '1');
    return res;
  }

  // Применение: updateMany по каждому экипажу в транзакции. assigned — сумма
  // РЕАЛЬНО обновлённых строк: заявка могла быть назначена другому экипажу/
  // удалена/уехать в финальный статус параллельно — честно отражаем в тосте.
  let assigned = 0;
  await db.$transaction(async (tx) => {
    for (const item of plan) {
      const updated = await tx.order.updateMany({
        where: {
          id: { in: item.orderIds },
          botId: id,
          // финальные статусы не трогаем даже при onlyUnassigned:false
          status: { notIn: [...FINAL_ORDER_STATUSES] },
          ...(onlyUnassigned ? { crewId: null } : {}),
        },
        data: { crewId: item.crewId },
      });
      assigned += updated.count;
    }
  });

  const result: CrewAutoAssignResult = { assigned, plan, unmatched: unmatchedList };
  const res = NextResponse.json(result);
  if (capped) res.headers.set('X-Truncated', '1');
  return res;
}

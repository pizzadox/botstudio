import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * Лёгкий опросник уведомлений: новые заявки и новые диалоги по всем ботам
 * пользователя с момента `since` + счётчики для бейджей навигации.
 */
export async function GET(req: NextRequest) {
  try {
    return await notificationsHandler(req);
  } catch (err) {
    console.error('[notifications]', err);
    return NextResponse.json({ error: 'Не удалось получить уведомления' }, { status: 500 });
  }
}

async function notificationsHandler(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const sinceParam = req.nextUrl.searchParams.get('since');
  // IMP-29-B2: клэмп курсора серверными часами — первый тик берет since
  // с часов браузера; ушедшие вперёд часы «проглатывали» новые события
  // (фильтр createdAt > будущего момента не находит ничего до их догоняния).
  const serverNow = new Date();
  const fallbackSince = new Date(serverNow.getTime() - 60 * 1000);
  const since = sinceParam ? new Date(sinceParam) : fallbackSince;
  const validSince =
    Number.isNaN(since.getTime()) || since > serverNow ? fallbackSince : since;

  const bots = await db.bot.findMany({ where: { userId: user.id }, select: { id: true, name: true } });
  const botIds = bots.map((b) => b.id);
  if (botIds.length === 0) {
    return NextResponse.json({
      now: new Date().toISOString(),
      newOrders: [],
      newChats: [],
      newComplaints: [], // IMP-25-15
      // IMP-29-B2: + unreadConvs — диалоги открытые, но не прочитанные оператором
      totals: { newOrders: 0, openConvs: 0, complaints: 0, unreadConvs: 0 }, // IMP-23-BE-03
      complaints: 0, // IMP-23-BE-03: счётчик новых жалоб (фронт читает optional)
    });
  }
  // IMP-BE21-19: Map вместо линейного find на каждое уведомление
  const botNames = new Map(bots.map((b) => [b.id, b.name]));
  const botName = (id: string) => botNames.get(id) ?? '';

  // Серверный курсор времени: фиксируем ДО запросов, чтобы заявка/диалог,
  // созданные во время выборки, гарантированно попали в СЛЕДУЮЩИЙ опрос
  // (курсор-время ответа меньше времени их создания).
  const now = new Date().toISOString();

  // IMP-29-B2 + IMP-29-INT: unreadConvs — открытые диалоги всех ботов юзера,
  // где непрочитанность = есть СООБЩЕНИЯ новее operatorReadAt. Прежнее
  // `updatedAt > operatorReadAt` всегда было истинно: Prisma @updatedAt
  // вычисляется на исполнение позже явного new Date() в update, т.е. сама
  // запись о прочтении перезаряжала флаг и бейдж не сбрасывался никогда.
  // Колонка-колонка сравнивается в JS (findMany/groupBy, масштаб ок) вместо
  // $queryRaw — без ловушек формата DateTime SQLite. Счётчик глотает ошибку
  // в 0 (null), чтобы сбой одного COUNT не ронял весь ответ watcher'у.
  const unreadConvsPromise = Promise.all([
    db.conversation.findMany({
      where: { bot: { userId: user.id }, status: 'open' },
      select: { id: true, operatorReadAt: true },
    }),
    db.message.groupBy({
      by: ['conversationId'],
      _max: { createdAt: true },
      where: { conversation: { bot: { userId: user.id }, status: 'open' } },
    }),
  ])
    .then(([convs, lastMsgRows]) => {
      const lastMsgAt = new Map(
        lastMsgRows.map((r) => [r.conversationId, r._max.createdAt] as const)
      );
      return convs.reduce((n, c) => {
        if (c.operatorReadAt === null) return n + 1;
        const lastAt = lastMsgAt.get(c.id);
        return lastAt && lastAt > c.operatorReadAt ? n + 1 : n;
      }, 0);
    })
    .catch(() => null);

  const [newOrders, newChats, newComplaints, totalNewOrders, totalOpenConvs, totalNewComplaints, unreadConvs] =
    await Promise.all([
      db.order.findMany({
        where: { botId: { in: botIds }, createdAt: { gt: validSince } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, number: true, type: true, address: true, botId: true },
      }),
      db.conversation.findMany({
        where: { botId: { in: botIds }, createdAt: { gt: validSince }, needsOperator: false },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, contact: true, source: true, botId: true },
      }),
      // IMP-25-15: новые жалобы (status='new') с момента курсора — той же формы,
      // что newOrders: тот же инкрементальный курсор `since` (дедуп на клиенте)
      db.complaint.findMany({
        where: { botId: { in: botIds }, status: 'new', createdAt: { gt: validSince } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          number: true,
          type: true,
          description: true,
          conversationId: true,
          createdAt: true,
          botId: true,
        },
      }),
      db.order.count({ where: { botId: { in: botIds }, status: 'new' } }),
      db.conversation.count({ where: { botId: { in: botIds }, status: 'open' } }),
      // IMP-23-BE-03: новые жалобы по ботам пользователя — бейдж реестра жалоб
      db.complaint.count({ where: { botId: { in: botIds }, status: 'new' } }),
      // IMP-29-B2: непрочитанные диалоги (null при сбое счётчика → 0 ниже)
      unreadConvsPromise,
    ]);

  // IMP-25-15: description в уведомлении обрезается до ~80 символов
  const shortDescription = (s: string): string =>
    s.length > 80 ? `${s.slice(0, 80)}…` : s;

  // Клиент должен использовать `now` как курсор следующего запроса. Раньше
  // курсор брался из часов браузера — расхождение часов браузера и сервера
  // делало одно и то же уведомление «новым» на каждом опросе, и тост
  // вылезал бесконечно.
  // IMP-BE21-11: личные данные опрашиваются часто — никакой кэш недопустим.
  const res = NextResponse.json({
    now,
    newOrders: newOrders.map((o) => ({ ...o, botName: botName(o.botId) })),
    newChats: newChats.map((c) => ({ ...c, botName: botName(c.botId) })),
    // IMP-25-15: топ-5 новых жалоб — как newOrders (курсор `since`, botName)
    newComplaints: newComplaints.map((c) => ({
      id: c.id,
      number: c.number,
      type: c.type,
      description: shortDescription(c.description),
      conversationId: c.conversationId,
      createdAt: c.createdAt.toISOString(),
      botId: c.botId,
      botName: botName(c.botId),
    })),
    totals: {
      newOrders: totalNewOrders,
      openConvs: totalOpenConvs,
      complaints: totalNewComplaints,
      unreadConvs: unreadConvs ?? 0, // IMP-29-B2: дефолт 0 — бейдж не «зависает» при сбое
    },
    complaints: totalNewComplaints, // IMP-23-BE-03: аддитивное поле (фронт читает optional)
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

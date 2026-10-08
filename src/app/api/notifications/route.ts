import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * Лёгкий опросник уведомлений: новые заявки и новые диалоги по всем ботам
 * пользователя с момента `since` + счётчики для бейджей навигации.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const sinceParam = req.nextUrl.searchParams.get('since');
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 60 * 1000);
  const validSince = Number.isNaN(since.getTime()) ? new Date(Date.now() - 60 * 1000) : since;

  const bots = await db.bot.findMany({ where: { userId: user.id }, select: { id: true, name: true } });
  const botIds = bots.map((b) => b.id);
  if (botIds.length === 0) {
    return NextResponse.json({
      now: new Date().toISOString(),
      newOrders: [],
      newChats: [],
      totals: { newOrders: 0, openConvs: 0 },
    });
  }
  // IMP-BE21-19: Map вместо линейного find на каждое уведомление
  const botNames = new Map(bots.map((b) => [b.id, b.name]));
  const botName = (id: string) => botNames.get(id) ?? '';

  // Серверный курсор времени: фиксируем ДО запросов, чтобы заявка/диалог,
  // созданные во время выборки, гарантированно попали в СЛЕДУЮЩИЙ опрос
  // (курсор-время ответа меньше времени их создания).
  const now = new Date().toISOString();

  const [newOrders, newChats, totalNewOrders, totalOpenConvs] = await Promise.all([
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
    db.order.count({ where: { botId: { in: botIds }, status: 'new' } }),
    db.conversation.count({ where: { botId: { in: botIds }, status: 'open' } }),
  ]);

  // Клиент должен использовать `now` как курсор следующего запроса. Раньше
  // курсор брался из часов браузера — расхождение часов браузера и сервера
  // делало одно и то же уведомление «новым» на каждом опросе, и тост
  // вылезал бесконечно.
  // IMP-BE21-11: личные данные опрашиваются часто — никакой кэш недопустим.
  const res = NextResponse.json({
    now,
    newOrders: newOrders.map((o) => ({ ...o, botName: botName(o.botId) })),
    newChats: newChats.map((c) => ({ ...c, botName: botName(c.botId) })),
    totals: { newOrders: totalNewOrders, openConvs: totalOpenConvs },
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/** Проверка заявки из тест-чата (город, координаты) */
import { db } from '@/lib/db';

(async () => {
  const bot = await db.bot.findFirst({ where: { name: { contains: 'двойник' } } });
  if (!bot) return;
  const orders = await db.order.findMany({
    where: { botId: bot.id },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });
  for (const o of orders) {
    console.log(
      `№${o.number} · ${o.type} · city=${o.city} · addr=${o.address} · lat=${o.lat} · lng=${o.lng} · geo=${o.geoSource} · size=${o.size}`
    );
  }
  await db.$disconnect();
})();

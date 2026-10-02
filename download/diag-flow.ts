/** Диагностика: flow бота Экосити (createOrder-узлы, адресные question), заявки */
import { db } from '@/lib/db';

(async () => {
  const bot = await db.bot.findFirst({ where: { user: { username: 'pizzadox' } } });
  if (!bot) {
    console.log('NO BOT');
    process.exit(1);
  }
  const flow = JSON.parse(bot.flow);
  console.log('nodes:', flow.nodes.length, 'edges:', flow.edges.length);
  for (const n of flow.nodes) {
    const isOrder = n.data && n.data.createOrder;
    const isAddr = n.type === 'question' && /addr|address/i.test(n.id);
    if (isOrder || isAddr) {
      console.log(JSON.stringify(n), '\n');
    }
  }
  const orders = await db.order.findMany({
    where: { botId: bot.id },
    orderBy: { createdAt: 'desc' },
    take: 6,
  });
  console.log(
    'recent orders:',
    orders.map((o) => ({
      n: o.number,
      type: o.type,
      addr: o.address,
      lat: o.lat,
      lng: o.lng,
      geo: o.geoSource,
    }))
  );
  await db.$disconnect();
})();

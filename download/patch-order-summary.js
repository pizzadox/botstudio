/**
 * Точечный патч текстов сводки заявки: адрес с городом ({{city}}, {{address}}).
 * Обновляет бота pizzadox и двойника demo.
 * Запуск: bun download/patch-order-summary.js
 */
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const FIXES = [
  {
    nodeId: 'n_order_done',
    patch: (text) =>
      text
        .replace('📍 Адрес: {{address}}', '📍 Адрес: {{city}}, {{address}}')
        .replace('🧾 Номер заявки: №{{order.number}}', '🧾 Номер заявки: №{{order.number}}'),
  },
  {
    nodeId: 'n_kgm_done',
    patch: (text) => text.replace('📍 Адрес: {{kgm_address}}', '📍 Адрес: {{kgm_city}}, {{kgm_address}}'),
  },
];

(async () => {
  const bots = await db.bot.findMany({
    where: { OR: [{ user: { username: 'pizzadox' } }, { user: { username: 'demo' } }] },
  });
  for (const bot of bots) {
    if (!bot.name.includes('Экосити')) continue;
    let flow;
    try {
      flow = JSON.parse(bot.flow);
    } catch {
      continue;
    }
    let changed = 0;
    for (const n of flow.nodes) {
      const fix = FIXES.find((f) => f.nodeId === n.id);
      if (fix && n.data?.text) {
        const next = fix.patch(n.data.text);
        if (next !== n.data.text) {
          n.data.text = next;
          changed++;
        }
      }
    }
    if (changed) {
      await db.bot.update({ where: { id: bot.id }, data: { flow: JSON.stringify(flow) } });
      console.log(`${bot.name}: обновлено текстов — ${changed}`);
    } else {
      console.log(`${bot.name}: без изменений`);
    }
  }
  await db.$disconnect();
})();

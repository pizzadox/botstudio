/**
 * Task 11: добавляет в сценарий «Экосити» (бот pizzadox) узел «Мои заявки»
 * и кнопку «🎫 Мои заявки» в главное меню (bm9). MAX принимает 9-10 рядов
 * (probe download/probe-max-rows.js — chat.not.found = формат валиден).
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

(async () => {
  const user = await prisma.user.findUnique({ where: { username: 'pizzadox' } });
  if (!user) throw new Error('user pizzadox not found');
  const bot = await prisma.bot.findFirst({ where: { userId: user.id, name: { contains: 'Экосити' } } });
  if (!bot) throw new Error('bot Экосити not found');

  const flow = JSON.parse(bot.flow);
  fs.writeFileSync(`download/backup-flow-eco2-${bot.id}.json`, bot.flow, 'utf8');

  const menu = flow.nodes.find((n) => n.id === 'n_menu');
  if (!menu) throw new Error('menu node n_menu not found');

  if (!menu.data.buttons.some((b) => b.id === 'bm9')) {
    menu.data.buttons.push({ id: 'bm9', text: '🎫 Мои заявки' });
  }

  if (!flow.nodes.some((n) => n.type === 'my_tickets')) {
    flow.nodes.push({
      id: 'n_myt',
      type: 'my_tickets',
      position: { x: 40, y: 300 },
      data: { label: 'Мои заявки' },
    });
    flow.edges.push({ id: 'e_menu_myt', source: 'n_menu', target: 'n_myt', sourceHandle: 'bm9' });
  }

  await prisma.bot.update({
    where: { id: bot.id },
    data: { flow: JSON.stringify(flow) },
  });

  const myt = flow.nodes.find((n) => n.type === 'my_tickets');
  console.log(JSON.stringify({
    botId: bot.id,
    nodes: flow.nodes.length,
    edges: flow.edges.length,
    menuButtons: menu.data.buttons.map((b) => b.text),
    myTicketsNode: myt ? myt.id : null,
  }));

  await prisma.$disconnect();
})();

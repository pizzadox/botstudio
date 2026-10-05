/**
 * Патч сценария «Экосити» (бот pizzadox): заявки с реальными номерами.
 *  - n_waste_menu: saveSelection 'container' (выбор кнопки → переменная);
 *  - n_order_done: createOrder (waste) + текст с №{{order.number}};
 *  - n_kgm_done:   createOrder (kgm)   + текст с №{{order.number}};
 *  - кнопки «📋 Статус заявки» после заявок → «📦 Мои заявки».
 * Запуск: bun download/update-orders-scenario.js
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const db = new PrismaClient();

(async () => {
  const bot = await db.bot.findFirst({
    where: { user: { username: 'pizzadox' } },
  });
  if (!bot) { console.error('Бот не найден'); process.exit(1); }
  console.log('BOT:', bot.name, bot.id);

  fs.writeFileSync(`download/backup-flow-orders-${bot.id}.json`, bot.flow, 'utf8');
  console.log('Бэкап → download/backup-flow-orders-%s.json', bot.id);

  const flow = JSON.parse(bot.flow);
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));

  // 1. Выбор контейнера сохраняем в переменную container
  const wasteMenu = byId.get('n_waste_menu');
  if (wasteMenu) {
    wasteMenu.data.saveSelection = 'container';
    console.log('n_waste_menu: saveSelection=container ✓');
  }

  // 2. Заявка на вывоз отходов
  const orderDone = byId.get('n_order_done');
  if (orderDone) {
    orderDone.data.createOrder = {
      type: 'waste',
      addressVar: 'address',
      phoneVar: 'phone',
      dateVar: 'date',
      sizeVar: 'container',
    };
    orderDone.data.text = [
      '✅ Заявка на вывоз принята!',
      '',
      '🧾 Номер заявки: №{{order.number}}',
      '📍 Адрес: {{address}}',
      '🗓 Дата подачи: {{date}}',
      '📞 Телефон: {{phone}}',
      '',
      'Диспетчер подтвердит заявку по телефону до конца рабочего дня.',
      '',
      '💬 Напишите сообщение по заявке — откройте «📦 Мои заявки» и выберите её: оператор ответит прямо в чате заявки.',
    ].join('\n');
    console.log('n_order_done: createOrder=waste + №{{order.number}} ✓');
  }

  // 3. Заявка на вывоз КГМ
  const kgmDone = byId.get('n_kgm_done');
  if (kgmDone) {
    kgmDone.data.createOrder = {
      type: 'kgm',
      addressVar: 'kgm_address',
      phoneVar: 'kgm_phone',
      dateVar: 'kgm_date',
      sizeVar: 'kgm_items',
    };
    kgmDone.data.text = [
      '✅ Заявка на вывоз КГМ принята!',
      '',
      '🧾 Номер заявки: №{{order.number}}',
      '📍 Адрес: {{kgm_address}}',
      '📦 Предметы: {{kgm_items}}',
      '🗓 Дата: {{kgm_date}}',
      '📞 Телефон: {{kgm_phone}}',
      '',
      'Водитель свяжется с вами перед выездом. Точную стоимость назовёт диспетчер.',
      '',
      '💬 Напишите сообщение по заявке — откройте «📦 Мои заявки» и выберите её: оператор ответит прямо в чате заявки.',
    ].join('\n');
    console.log('n_kgm_done: createOrder=kgm + №{{order.number}} ✓');
  }

  // 4. Кнопки после заявок → «📦 Мои заявки»
  for (const nid of ['n_order_after', 'n_kgm_after']) {
    const node = byId.get(nid);
    if (!node) continue;
    for (const b of node.data.buttons ?? []) {
      if (b.text.includes('Статус заявки')) {
        b.text = '📦 Мои заявки';
        console.log(`${nid}: кнопка → «📦 Мои заявки» ✓`);
      }
    }
  }

  await db.bot.update({
    where: { id: bot.id },
    data: { flow: JSON.stringify(flow) },
  });
  console.log(`Сценарий обновлён: ${flow.nodes.length} узлов, ${flow.edges.length} связей`);

  await db.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });

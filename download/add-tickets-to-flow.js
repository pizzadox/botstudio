/**
 * Вставка узлов «Заявка» в сценарий «Экосити» (бот pizzadox):
 *  - вывоз отходов → заявка waste (адрес/дата/телефон) + номер в сводке клиенту
 *  - вывоз КГМ → заявка kgm (адрес/предметы/дата/телефон) + номер в сводке
 *  - жалоба → заявка complaint (описание/когда) + номер в подтверждении
 * Запуск: node download/add-tickets-to-flow.js
 */
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

(async () => {
  const bot = await db.bot.findFirst({ where: { user: { username: 'pizzadox' } } });
  if (!bot) { console.error('бот не найден'); process.exit(1); }
  const flow = JSON.parse(bot.flow);
  const nodes = flow.nodes.filter((n) => !['n_ticket_waste', 'n_ticket_kgm', 'n_ticket_cmp'].includes(n.id));
  const edges = flow.edges.filter((e) => !['n_ticket_waste', 'n_ticket_kgm', 'n_ticket_cmp'].includes(e.source));
  const node = (id) => nodes.find((n) => n.id === id);

  // ── 1. Заявка на вывоз отходов ──
  nodes.push({
    id: 'n_ticket_waste', type: 'ticket', position: { x: 990, y: 1090 },
    data: {
      label: 'Заявка на вывоз',
      ticketType: 'waste',
      subject: 'Вывоз отходов',
      addressVar: 'address', dateVar: 'date', phoneVar: 'phone',
    },
  });
  const i1 = edges.findIndex((e) => e.source === 'n_delay_order' && e.target === 'n_order_done');
  if (i1 >= 0) edges.splice(i1, 1);
  edges.push({ id: 'e_tw1', source: 'n_delay_order', target: 'n_ticket_waste' });
  edges.push({ id: 'e_tw2', source: 'n_ticket_waste', target: 'n_order_done' });
  const od = node('n_order_done');
  if (od) {
    od.data.text = '✅ Заявка на вывоз принята!\n\n📋 Номер заявки: {{ticket_number}}\n📍 Адрес: {{address}}\n🗓 Дата подачи: {{date}}\n📞 Телефон: {{phone}}\n\nОператор уже уведомлён и перезвонит для подтверждения до конца рабочего дня.';
    od.data.label = 'Заявка принята (с номером)';
  }

  // ── 2. Заявка на вывоз КГМ ──
  nodes.push({
    id: 'n_ticket_kgm', type: 'ticket', position: { x: 2280, y: 1060 },
    data: {
      label: 'Заявка на вывоз КГМ',
      ticketType: 'kgm',
      subject: 'Вывоз КГМ',
      addressVar: 'kgm_address', dateVar: 'kgm_date', phoneVar: 'kgm_phone', detailsVar: 'kgm_items',
    },
  });
  const i2 = edges.findIndex((e) => e.source === 'n_kgm_delay' && e.target === 'n_kgm_done');
  if (i2 >= 0) edges.splice(i2, 1);
  edges.push({ id: 'e_tk1', source: 'n_kgm_delay', target: 'n_ticket_kgm' });
  edges.push({ id: 'e_tk2', source: 'n_ticket_kgm', target: 'n_kgm_done' });
  const kd = node('n_kgm_done');
  if (kd) {
    kd.data.text = '✅ Заявка на вывоз КГМ принята!\n\n📋 Номер заявки: {{ticket_number}}\n📍 Адрес: {{kgm_address}}\n📦 Предметы: {{kgm_items}}\n🗓 Дата: {{kgm_date}}\n📞 Телефон: {{kgm_phone}}\n\nОператор уведомлён — водитель свяжется с вами перед выездом.';
    kd.data.label = 'Заявка КГМ принята (с номером)';
  }

  // ── 3. Жалоба → заявка ──
  nodes.push({
    id: 'n_ticket_cmp', type: 'ticket', position: { x: 5010, y: 760 },
    data: {
      label: 'Заявка-жалоба',
      ticketType: 'complaint',
      subject: 'Проблема с вывозом',
      dateVar: 'cmp_when', detailsVar: 'cmp_desc',
    },
  });
  const i3 = edges.findIndex((e) => e.source === 'n_cmp_when' && e.target === 'n_cmp_done');
  if (i3 >= 0) edges.splice(i3, 1);
  edges.push({ id: 'e_tc1', source: 'n_cmp_when', target: 'n_ticket_cmp' });
  edges.push({ id: 'e_tc2', source: 'n_ticket_cmp', target: 'n_cmp_done' });
  const cd = node('n_cmp_done');
  if (cd) {
    cd.data.text = '✅ Жалоба зарегистрирована!\n\n📋 Номер обращения: {{ticket_number}}\n📝 Суть: {{cmp_desc}}\n🗓 Когда: {{cmp_when}}\n\nОператор уведомлён. Если проблема срочная (мусор не вывезен более 2 дней) — нажмите «👤 Оператор», ответим сразу.';
    cd.data.label = 'Жалоба принята (с номером)';
  }

  await db.bot.update({
    where: { id: bot.id },
    data: { flow: JSON.stringify({ nodes, edges }) },
  });
  console.log(`Сценарий обновлён: ${nodes.length} узлов / ${edges.length} связей (+3 узла «Заявка»)`);
  console.log('Тексты сводок теперь показывают клиенту Номер заявки: {{ticket_number}}');

  // ── База знаний: номера заявок ──
  const kb = await db.knowledgeItem.findFirst({ where: { botId: bot.id, title: 'Заявки и статус' } });
  if (kb) {
    await db.knowledgeItem.update({
      where: { id: kb.id },
      data: {
        content: 'Заявки принимаются круглосуточно через бота; каждая получает номер вида 1001, 1002… (номер приходит сразу после оформления). Срок обработки — 1 рабочий день. Статусы заявки: новая → в работе → машина назначена → выполнена. По номеру заявки оператор найдёт её в системе. Если машина не пришла до 19:00 назначенного дня — оформите жалобу через меню «⚠️ Проблема с вывозом» или позовите оператора.',
      },
    });
    console.log('KB «Заявки и статус» обновлена (номера 1001+)');
  }
  await db.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });

/**
 * Патч сценария «Экосити» — анкета клиента и выбор даты/времени кнопками.
 *
 * 1. Первое обращение: приветствие → ИМЯ → ТЕЛЕФОН (валидация) → главное меню.
 * 2. Заявка на вывоз/КГМ: дата КНОПКАМИ (Сегодня/Завтра/Послезавтра/Другая дата),
 *    затем время КНОПКАМИ (утро/день/вечер/точное время).
 * 3. Телефон в заявке спрашивается только если не оставлен при первом обращении.
 * 4. Валидация: телефон (10–11 цифр) и адрес (геокодинг) на question-узлах.
 * 5. Имя из анкеты попадает в заявку (nameVar).
 *
 * Идемпотентно. Запуск: bun download/setup-ecositi-intake.js
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const db = new PrismaClient();

const DATE_BTNS = [
  ['d1', 'Сегодня'],
  ['d2', 'Завтра'],
  ['d3', 'Послезавтра'],
  ['d4', '📅 Другая дата'],
  ['d5', '↩️ В главное меню'],
];
const TIME_BTNS = [
  ['t1', '🌅 Утро (9:00–12:00)'],
  ['t2', '☀️ День (12:00–16:00)'],
  ['t3', '🌆 Вечер (16:00–19:00)'],
  ['t4', '⏰ Точное время'],
  ['t5', '↩️ В главное меню'],
];

// ─── Новые узлы ──────────────────────────────────────────────────────────────
const NEW_NODES = [
  // анкета при первом обращении (пропускается, если имя/телефон уже известны)
  {
    id: 'n_have_name',
    type: 'condition',
    position: { x: 640, y: 0 },
    data: {
      label: 'Имя известно?',
      condition: { left: '{{name}}', op: 'not_empty', right: '' },
    },
  },
  {
    id: 'n_have_phone_entry',
    type: 'condition',
    position: { x: 900, y: 0 },
    data: {
      label: 'Телефон известен?',
      condition: { left: '{{phone}}', op: 'not_empty', right: '' },
    },
  },
  {
    id: 'n_ask_name',
    type: 'question',
    position: { x: 640, y: 160 },
    data: {
      label: 'Имя клиента',
      text: 'Здравствуйте! 🙋 Как вас зовут? (имя подставим в заявку, чтобы обращаться по имени)',
      variable: 'name',
    },
  },
  {
    id: 'n_ask_phone',
    type: 'question',
    position: { x: 640, y: 320 },
    data: {
      label: 'Телефон клиента',
      text: 'Приятно познакомиться, {{name}}! 📞 Оставьте ваш телефон для связи — диспетчер звонит по нему при подтверждении заявок:',
      variable: 'phone',
      validate: 'phone',
    },
  },
  // дата/время — вывоз отходов
  {
    id: 'n_when',
    type: 'buttons',
    position: { x: 760, y: 860 },
    data: {
      label: 'Дата подачи (кнопки)',
      text: '🗓 Когда подать машину?',
      saveSelection: 'date',
      buttons: DATE_BTNS.map(([id, text]) => ({ id, text })),
    },
  },
  {
    id: 'n_time',
    type: 'buttons',
    position: { x: 760, y: 1020 },
    data: {
      label: 'Время подачи (кнопки)',
      text: '🕘 В какое время удобно?',
      saveSelection: 'time_part',
      buttons: TIME_BTNS.map(([id, text]) => ({ id, text })),
    },
  },
  {
    id: 'n_time_exact',
    type: 'question',
    position: { x: 1040, y: 1020 },
    data: {
      label: 'Точное время',
      text: 'Укажите удобное время подачи (например 14:00):',
      variable: 'time_part',
    },
  },
  {
    id: 'n_have_phone',
    type: 'condition',
    position: { x: 760, y: 1180 },
    data: { label: 'Телефон известен?', condition: { left: '{{phone}}', op: 'not_empty', right: '' } },
  },
  // дата/время — КГМ
  {
    id: 'n_kgm_when',
    type: 'buttons',
    position: { x: 1980, y: 1000 },
    data: {
      label: 'Дата КГМ (кнопки)',
      text: '🗓 Когда подать машину на вывоз КГМ?',
      saveSelection: 'kgm_date',
      buttons: DATE_BTNS.map(([id, text]) => ({ id, text })),
    },
  },
  {
    id: 'n_kgm_time',
    type: 'buttons',
    position: { x: 1980, y: 1160 },
    data: {
      label: 'Время КГМ (кнопки)',
      text: '🕘 В какое время удобно?',
      saveSelection: 'kgm_time_part',
      buttons: TIME_BTNS.map(([id, text]) => ({ id, text })),
    },
  },
  {
    id: 'n_kgm_time_exact',
    type: 'question',
    position: { x: 2260, y: 1160 },
    data: {
      label: 'Точное время КГМ',
      text: 'Укажите удобное время подачи (например 14:00):',
      variable: 'kgm_time_part',
    },
  },
  {
    id: 'n_have_phone_kgm',
    type: 'condition',
    position: { x: 1980, y: 1320 },
    data: {
      label: 'Телефон известен?',
      condition: { left: '{{phone}}', op: 'not_empty', right: '' },
    },
  },
];

/** Обновление существующих узлов */
const UPDATES = {
  // анкета: телефон валидируем
  n_order_date: {
    position: { x: 480, y: 1000 },
    data: {
      label: 'Дата вручную',
      text: 'Укажите удобные дату и время (например: завтра до 12:00):',
      variable: 'date',
    },
  },
  n_order_phone: {
    position: { x: 480, y: 1180 },
    data: {
      label: 'Телефон заявки',
      text: '📞 Оставьте контактный телефон для связи:',
      variable: 'phone',
      validate: 'phone',
    },
  },
  n_kgm_date: {
    position: { x: 1700, y: 1140 },
    data: {
      label: 'Дата КГМ вручную',
      text: 'Укажите удобные дату и время (например: завтра до 12:00):',
      variable: 'kgm_date',
    },
  },
  n_kgm_phone: {
    position: { x: 1700, y: 1320 },
    data: {
      label: 'Телефон КГМ',
      text: '📞 Оставьте контактный телефон:',
      variable: 'kgm_phone',
      validate: 'phone',
    },
  },
  // валидация адреса на улицах
  n_street: { dataPatch: { validate: 'address' } },
  n_kgm_street: { dataPatch: { validate: 'address' } },
  // имя из анкеты + дата/время в createOrder
  n_order_done: {
    dataPatch: { createOrder: { type: 'waste', nameVar: 'name', cityVar: 'city', addressVar: '{{city}}, {{address}}', phoneVar: 'phone', dateVar: '{{date}}, {{time_part}}', sizeVar: 'container' } },
  },
  n_kgm_done: {
    dataPatch: {
      createOrder: {
        type: 'kgm',
        nameVar: 'name',
        cityVar: 'kgm_city',
        addressVar: '{{kgm_city}}, {{kgm_address}}',
        phoneVar: 'phone',
        dateVar: '{{kgm_date}}, {{kgm_time_part}}',
        sizeVar: 'kgm_items',
      },
    },
  },
};

const TEXT_PATCH = [
  ['n_order_done', '🗓 Дата подачи: {{date}}', '🗓 Дата подачи: {{date}}, {{time_part}}'],
  ['n_kgm_done', '🗓 Дата: {{kgm_date}}', '🗓 Дата: {{kgm_date}}, {{kgm_time_part}}'],
];

/** Узлы, ставшие лишними (телефон теперь валидируется при вводе) */
const REMOVE_NODES = ['n_order_check', 'n_phone_reask'];

/** Позиции нижних узлов КГМ (освобождаем место под время/условие) */
const REPOSITION = {
  n_kgm_delay: { x: 1980, y: 1480 },
  n_kgm_done: { x: 1980, y: 1640 },
  n_kgm_after: { x: 1980, y: 1820 },
};

const E = (source, target, handle, idx) => ({
  id: `ei${source}_${handle ?? target}_${idx ?? 0}`,
  source,
  target,
  ...(handle ? { sourceHandle: handle } : {}),
});

(async () => {
  const bot = await db.bot.findFirst({
    where: { user: { username: 'pizzadox' } },
  });
  if (!bot) {
    console.error('Бот не найден');
    process.exit(1);
  }
  console.log('BOT:', bot.name, bot.id);

  const flow = JSON.parse(bot.flow);
  const before = { nodes: flow.nodes.length, edges: flow.edges.length };
  fs.writeFileSync(`download/backup-flow-intake-${bot.id}.json`, bot.flow, 'utf8');

  // 1. Удаляем лишние узлы (валидация телефона теперь при вводе) и прошлые версии новых
  const removed = new Set([...REMOVE_NODES, ...NEW_NODES.map((n) => n.id)]);
  flow.nodes = flow.nodes.filter((n) => !removed.has(n.id));
  flow.edges = flow.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target));

  // 2. Разрываем старые прямые связи, которые заменяет анкета/кнопки
  const dropPairs = [
    ['n_greet', 'n_menu'],
    ['n_greet', 'n_ask_name'],
    ['n_ask_name', 'n_ask_phone'],
    ['n_ask_phone', 'n_menu'],
    ['n_street', 'n_when'],
    ['n_street', 'n_order_date'],
    ['n_order_date', 'n_have_phone'],
    ['n_when', 'n_have_phone'],
    ['n_time', 'n_have_phone'],
    ['n_kgm_items', 'n_kgm_when'],
    ['n_kgm_when', 'n_kgm_time'],
    ['n_kgm_time', 'n_have_phone_kgm'],
  ];
  flow.edges = flow.edges.filter(
    (e) => !dropPairs.some(([s, t]) => e.source === s && e.target === t)
  );

  // 3. Обновляем существующие узлы
  for (const n of flow.nodes) {
    const upd = UPDATES[n.id];
    if (!upd) continue;
    if (upd.position) n.position = { ...n.position, ...upd.position };
    if (upd.data) n.data = { ...upd.data, label: upd.data.label ?? n.data?.label };
    if (upd.dataPatch) n.data = { ...n.data, ...upd.dataPatch };
  }
  for (const [nodeId, from, to] of TEXT_PATCH) {
    const n = flow.nodes.find((x) => x.id === nodeId);
    if (n?.data?.text && n.data.text.includes(from)) {
      n.data.text = n.data.text.replace(from, to);
    }
  }
  for (const [nodeId, pos] of Object.entries(REPOSITION)) {
    const n = flow.nodes.find((x) => x.id === nodeId);
    if (n) n.position = { ...pos };
  }

  // 4. Новые узлы и связи
  flow.nodes.push(...NEW_NODES);
  flow.edges.push(
    // анкета при первом обращении (с пропусками, если уже известны)
    E('n_greet', 'n_have_name'),
    E('n_have_name', 'n_have_phone_entry', 'yes', 0),
    E('n_have_name', 'n_ask_name', 'no', 0),
    E('n_ask_name', 'n_have_phone_entry'),
    E('n_have_phone_entry', 'n_menu', 'yes', 0),
    E('n_have_phone_entry', 'n_ask_phone', 'no', 0),
    E('n_ask_phone', 'n_menu'),
    // вывоз отходов: улица → дата (кнопки) → время (кнопки) → телефон (если неизвестен)
    E('n_street', 'n_when'),
    ...DATE_BTNS.slice(0, 3).map(([id], i) => E('n_when', 'n_time', id, i)),
    E('n_when', 'n_order_date', 'd4', 0),
    E('n_when', 'n_menu', 'd5', 0),
    E('n_order_date', 'n_time'),
    ...TIME_BTNS.slice(0, 3).map(([id], i) => E('n_time', 'n_have_phone', id, i)),
    E('n_time', 'n_time_exact', 't4', 0),
    E('n_time', 'n_menu', 't5', 0),
    E('n_time_exact', 'n_have_phone'),
    E('n_have_phone', 'n_delay_order', 'yes', 0),
    E('n_have_phone', 'n_order_phone', 'no', 0),
    E('n_order_phone', 'n_delay_order'),
    // КГМ: предметы → дата (кнопки) → время (кнопки) → телефон (если неизвестен)
    E('n_kgm_items', 'n_kgm_when'),
    ...DATE_BTNS.slice(0, 3).map(([id], i) => E('n_kgm_when', 'n_kgm_time', id, i)),
    E('n_kgm_when', 'n_kgm_date', 'd4', 0),
    E('n_kgm_when', 'n_menu', 'd5', 0),
    E('n_kgm_date', 'n_kgm_time'),
    ...TIME_BTNS.slice(0, 3).map(([id], i) => E('n_kgm_time', 'n_have_phone_kgm', id, i)),
    E('n_kgm_time', 'n_kgm_time_exact', 't4', 0),
    E('n_kgm_time', 'n_menu', 't5', 0),
    E('n_kgm_time_exact', 'n_have_phone_kgm'),
    E('n_have_phone_kgm', 'n_kgm_delay', 'yes', 0),
    E('n_have_phone_kgm', 'n_kgm_phone', 'no', 0),
    E('n_kgm_phone', 'n_kgm_delay')
  );

  // защита от дублей связей
  const seen = new Set();
  flow.edges = flow.edges.filter((e) => {
    const k = `${e.source}|${e.sourceHandle ?? ''}|${e.target}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  await db.bot.update({ where: { id: bot.id }, data: { flow: JSON.stringify(flow) } });
  console.log(
    `Сценарий обновлён: узлов ${before.nodes} → ${flow.nodes.length}, связей ${before.edges} → ${flow.edges.length}`
  );

  await db.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Патч сценария «Экосити»: выбор города обслуживания перед адресом заявки.
 *
 * - Ветки вывоза отходов и КГМ: перед вводом улицы — кнопки городов
 *   (Великий Новгород, Боровичи, Валдай, Старая Русса, Окуловка + «Другой город»).
 * - Адрес для заявки собирается шаблоном «{{city}}, {{street}}» —
 *   полный адрес нужен для точной точки на карте (геокодинг).
 * - Меню выбора контейнера запоминает выбор ({{container}} — объём в заявке).
 * - База знаний: города обслуживания.
 *
 * Идемпотентно: повторный запуск не создаёт дублей узлов/связей.
 * Запуск: bun download/setup-ecositi-cities.js
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const db = new PrismaClient();

const CITY_BTNS = [
  ['cb1', 'Великий Новгород'],
  ['cb2', 'Боровичи'],
  ['cb3', 'Валдай'],
  ['cb4', 'Старая Русса'],
  ['cb5', 'Окуловка'],
  ['cb6', '🌍 Другой город'],
  ['cb7', '↩️ В главное меню'],
];
const KB_BTNS = [
  ['kb1', 'Великий Новгород'],
  ['kb2', 'Боровичи'],
  ['kb3', 'Валдай'],
  ['kb4', 'Старая Русса'],
  ['kb5', 'Окуловка'],
  ['kb6', '🌍 Другой город'],
  ['kb7', '↩️ В главное меню'],
];

const NEW_NODES = [
  // ── Ветка вывоза отходов ──
  {
    id: 'n_city',
    type: 'buttons',
    position: { x: 700, y: 520 },
    data: {
      label: 'Выбор города (вывоз)',
      text: '🗺 Выберите ваш город — мы работаем по всей Новгородской области:',
      saveSelection: 'city',
      buttons: CITY_BTNS.map(([id, text]) => ({ id, text })),
    },
  },
  {
    id: 'n_city_other',
    type: 'question',
    position: { x: 430, y: 680 },
    data: {
      label: 'Город вручную (вывоз)',
      text: 'Напишите название вашего города — обслуживаем всю Новгородскую область:',
      variable: 'city',
    },
  },
  {
    id: 'n_street',
    type: 'question',
    position: { x: 700, y: 840 },
    data: {
      label: 'Улица и дом (вывоз)',
      text: '📍 Город: {{city}}\nУкажите улицу и номер дома:',
      variable: 'address',
    },
  },
  // ── Ветка КГМ ──
  {
    id: 'n_city_kgm',
    type: 'buttons',
    position: { x: 1840, y: 520 },
    data: {
      label: 'Выбор города (КГМ)',
      text: '🗺 Выберите ваш город — мы работаем по всей Новгородской области:',
      saveSelection: 'kgm_city',
      buttons: KB_BTNS.map(([id, text]) => ({ id, text })),
    },
  },
  {
    id: 'n_city_other_kgm',
    type: 'question',
    position: { x: 2140, y: 680 },
    data: {
      label: 'Город вручную (КГМ)',
      text: 'Напишите название вашего города — обслуживаем всю Новгородскую область:',
      variable: 'kgm_city',
    },
  },
  {
    id: 'n_kgm_street',
    type: 'question',
    position: { x: 1980, y: 840 },
    data: {
      label: 'Улица и дом (КГМ)',
      text: '📍 Город: {{kgm_city}}\nУкажите улицу и дом, откуда вывезти КГМ:',
      variable: 'kgm_address',
    },
  },
];

/** Узлы, сдвигаемые вниз, чтобы освободить место новым шагам */
const SHIFT_DOWN = {
  // вывоз отходов (после адреса)
  n_order_date: 260,
  n_order_phone: 260,
  n_order_check: 260,
  n_phone_reask: 260,
  n_delay_order: 260,
  n_order_done: 260,
  n_order_after: 260,
  // КГМ
  n_kgm_items: 260,
  n_kgm_date: 260,
  n_kgm_phone: 260,
  n_kgm_delay: 260,
  n_kgm_done: 260,
  n_kgm_after: 260,
};

/** Сообщения «контейнер выбран» вместо бывших вопросов адреса */
const ADDR_TO_CITY_MSG = {
  n_addr08: {
    label: 'Контейнер 0,8 м³ выбран',
    text: 'Выбран контейнер 0,8 м³ ✅\nТеперь выберите ваш город:',
  },
  n_addr8: {
    label: 'Контейнер 8 м³ выбран',
    text: 'Выбран контейнер 8 м³ (бункер) ✅\nТеперь выберите ваш город:',
  },
  n_addr20: {
    label: 'Контейнер 20 м³ выбран',
    text: 'Выбран контейнер 20 м³ (промышленный) ✅\nТеперь выберите ваш город:',
  },
  n_kgm_addr: {
    label: 'КГМ — выбор города',
    text: '📦 Оформляем вывоз КГМ.\nВыберите ваш город обслуживания:',
  },
};

/** Новые createOrder-конфиги: город + полный адрес шаблоном */
const ORDER_CFG = {
  n_order_done: {
    type: 'waste',
    cityVar: 'city',
    addressVar: '{{city}}, {{address}}',
    phoneVar: 'phone',
    dateVar: 'date',
    sizeVar: 'container',
  },
  n_kgm_done: {
    type: 'kgm',
    cityVar: 'kgm_city',
    addressVar: '{{kgm_city}}, {{kgm_address}}',
    phoneVar: 'kgm_phone',
    dateVar: 'kgm_date',
    sizeVar: 'kgm_items',
  },
};

const KB_UPSERTS = [
  [
    'Города обслуживания',
    'Экосити работает по всей Новгородской области: Великий Новгород, Боровичи, Валдай, Старая Русса, Окуловка, Чудово, Сольцы, Малая Вишера, Крестцы, Хвойная, Пестово, Демянск, Любытино. Города нет в списке? Напишите название — диспетчер подтвердит возможность вывоза.',
  ],
  [
    'О компании',
    'Экосити — региональный оператор по вывозу отходов: ТКО, КГМ, строймусор. Зона обслуживания — Новгородская область: Великий Новгород, Боровичи, Валдай, Старая Русса, Окуловка, Чудово и другие города области. Диспетчерская: 8-800-555-01-23 (бесплатно, пн–сб 7:00–19:00). Email: info@ekociti.ru. Сайт: ekociti.ru.',
  ],
];

function edgesWithoutTouching(edges, nodeIds) {
  return edges.filter((e) => !nodeIds.has(e.source) && !nodeIds.has(e.target));
}

(async () => {
  const bot = await db.bot.findFirst({
    where: { user: { username: 'pizzadox' } },
    include: { knowledge: true },
  });
  if (!bot) {
    console.error('Бот не найден');
    process.exit(1);
  }
  console.log('BOT:', bot.name, bot.id, '| KB:', bot.knowledge.length);

  const flow = JSON.parse(bot.flow);
  const before = { nodes: flow.nodes.length, edges: flow.edges.length };

  fs.writeFileSync(`download/backup-flow-cities-${bot.id}.json`, bot.flow, 'utf8');
  console.log('Бэкап flow → download/backup-flow-cities-%s.json', bot.id);

  // 1. Удаляем прошлые версии новых узлов и их связи (идемпотентность)
  const newIds = new Set(NEW_NODES.map((n) => n.id));
  flow.nodes = flow.nodes.filter((n) => !newIds.has(n.id));
  flow.edges = flow.edges.filter(
    (e) => !newIds.has(e.source) && !newIds.has(e.target)
  );

  // 2. Старые прямые связи «адрес → дата» (мимо города) больше не нужны
  const dropPairs = [
    ['n_addr08', 'n_order_date'],
    ['n_addr8', 'n_order_date'],
    ['n_addr20', 'n_order_date'],
    ['n_kgm_addr', 'n_kgm_items'],
  ];
  flow.edges = flow.edges.filter(
    (e) => !dropPairs.some(([s, t]) => e.source === s && e.target === t)
  );

  // 3. Адресные вопросы → сообщения «выберите город»
  for (const n of flow.nodes) {
    if (ADDR_TO_CITY_MSG[n.id]) {
      const { label, text } = ADDR_TO_CITY_MSG[n.id];
      n.type = 'message';
      n.data = { ...n.data, label, text };
      delete n.data.variable;
    }
    // 4. createOrder: город + полный адрес
    if (ORDER_CFG[n.id] && n.data) {
      n.data.createOrder = ORDER_CFG[n.id];
    }
    // 5. Меню контейнеров запоминает выбор ({{container}})
    if (n.id === 'n_waste_menu' && n.data) {
      n.data.saveSelection = 'container';
    }
    // 6. Сдвиг нижних узлов вниз
    if (SHIFT_DOWN[n.id] && n.position) {
      n.position = { ...n.position, y: n.position.y + SHIFT_DOWN[n.id] };
    }
  }

  // 7. Новые узлы + связи через город
  flow.nodes.push(...NEW_NODES);
  const E = (source, target, handle) => ({
    id: `ec${source}_${handle ?? target}`,
    source,
    target,
    ...(handle ? { sourceHandle: handle } : {}),
  });
  flow.edges.push(
    E('n_addr08', 'n_city'),
    E('n_addr8', 'n_city'),
    E('n_addr20', 'n_city'),
    ...CITY_BTNS.slice(0, 5).map(([id]) => E('n_city', 'n_street', id)),
    E('n_city', 'n_city_other', 'cb6'),
    E('n_city', 'n_menu', 'cb7'),
    E('n_city_other', 'n_street'),
    E('n_street', 'n_order_date'),
    E('n_kgm_addr', 'n_city_kgm'),
    ...KB_BTNS.slice(0, 5).map(([id]) => E('n_city_kgm', 'n_kgm_street', id)),
    E('n_city_kgm', 'n_city_other_kgm', 'kb6'),
    E('n_city_kgm', 'n_menu', 'kb7'),
    E('n_city_other_kgm', 'n_kgm_street'),
    E('n_kgm_street', 'n_kgm_items')
  );

  // Защита от дублей связей (source, sourceHandle, target)
  const seen = new Set();
  flow.edges = flow.edges.filter((e) => {
    const k = `${e.source}|${e.sourceHandle ?? ''}|${e.target}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const flowJson = JSON.stringify(flow);
  await db.bot.update({ where: { id: bot.id }, data: { flow: flowJson } });
  console.log(
    `Сценарий обновлён: узлов ${before.nodes} → ${flow.nodes.length}, связей ${before.edges} → ${flow.edges.length}`
  );

  // 8. База знаний: города обслуживания
  for (const [title, content] of KB_UPSERTS) {
    const existing = await db.knowledgeItem.findFirst({ where: { botId: bot.id, title } });
    if (existing) {
      await db.knowledgeItem.update({ where: { id: existing.id }, data: { content } });
    } else {
      await db.knowledgeItem.create({ data: { botId: bot.id, title, content } });
    }
    console.log('KB:', title, existing ? 'обновлена' : 'добавлена');
  }
  const kbCount = await db.knowledgeItem.count({ where: { botId: bot.id } });
  console.log('База знаний:', kbCount, 'записей');

  await db.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * E2E: город в заявке (выбор кнопкой + «Другой город»), полный адрес,
 * мгновенные координаты, закрытие обращения → главное меню с кнопками.
 * Изолированный тест-бот/канал, реальный flow Экосити (ветки города), без внешних отправок.
 * Запуск: bun download/e2e-city-close.ts
 */
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { processInbound } from '@/lib/webhook';
import { createSession } from '@/lib/auth';
import { POST as closePOST } from '@/app/api/conversations/[id]/close/route';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
    console.log(`✅ ${name}`);
  } else {
    failed++;
    console.log(`❌ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const marker = `e2ecity${Date.now()}`;
const BOT_FLOW = JSON.stringify({
  nodes: [
    { id: 'n_start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Старт' } },
    {
      id: 'n_greet',
      type: 'message',
      position: { x: 0, y: 100 },
      data: { text: 'Здравствуйте! Это «Экосити».' },
    },
    {
      id: 'n_menu',
      type: 'buttons',
      position: { x: 0, y: 200 },
      data: {
        label: 'Главное меню',
        text: 'Главное меню — выберите, что вас интересует:',
        buttons: [
          { id: 'bm1', text: '🚛 Заказать вывоз отходов' },
          { id: 'bm8', text: '👤 Оператор' },
        ],
      },
    },
    {
      id: 'n_waste_menu',
      type: 'buttons',
      position: { x: 0, y: 250 },
      data: {
        label: 'Выбор контейнера',
        text: 'Какой контейнер нужен? 🚛',
        saveSelection: 'container',
        buttons: [
          { id: 'w1', text: '🛢 0,8 м³ (стандарт)' },
          { id: 'w5', text: '↩️ В главное меню' },
        ],
      },
    },
    {
      id: 'n_addr08',
      type: 'message',
      position: { x: 0, y: 300 },
      data: { label: 'Контейнер выбран', text: 'Выбран контейнер 0,8 м³ ✅\nТеперь выберите ваш город:' },
    },
    {
      id: 'n_city',
      type: 'buttons',
      position: { x: 0, y: 400 },
      data: {
        label: 'Выбор города',
        text: '🗺 Выберите ваш город — мы работаем по всей Новгородской области:',
        saveSelection: 'city',
        buttons: [
          { id: 'cb1', text: 'Великий Новгород' },
          { id: 'cb2', text: 'Боровичи' },
          { id: 'cb6', text: '🌍 Другой город' },
          { id: 'cb7', text: '↩️ В главное меню' },
        ],
      },
    },
    {
      id: 'n_city_other',
      type: 'question',
      position: { x: 0, y: 500 },
      data: { text: 'Напишите название вашего города:', variable: 'city' },
    },
    {
      id: 'n_street',
      type: 'question',
      position: { x: 0, y: 600 },
      data: { text: '📍 Город: {{city}}\nУкажите улицу и номер дома:', variable: 'address' },
    },
    {
      id: 'n_order_date',
      type: 'question',
      position: { x: 0, y: 700 },
      data: { text: '🗓 На какую дату подать машину?', variable: 'date' },
    },
    {
      id: 'n_order_phone',
      type: 'question',
      position: { x: 0, y: 800 },
      data: { text: '📞 Оставьте контактный телефон:', variable: 'phone' },
    },
    {
      id: 'n_delay_order',
      type: 'delay',
      position: { x: 0, y: 900 },
      data: { seconds: 0 },
    },
    {
      id: 'n_order_done',
      type: 'message',
      position: { x: 0, y: 1000 },
      data: {
        label: 'Заявка принята',
        text: '✅ Заявка принята!\n🧾 Номер: №{{order.number}}\n📍 Адрес: {{address}}',
        createOrder: {
          type: 'waste',
          cityVar: 'city',
          addressVar: '{{city}}, {{address}}',
          phoneVar: 'phone',
          dateVar: 'date',
          sizeVar: 'container',
        },
      },
    },
    { id: 'n_end', type: 'end', position: { x: 0, y: 1100 }, data: {} },
    {
      id: 'n_handoff',
      type: 'handoff',
      position: { x: 200, y: 200 },
      data: { text: 'Соединяю с оператором…' },
    },
  ],
  edges: [
    { id: 'e1', source: 'n_start', target: 'n_greet' },
    { id: 'e2', source: 'n_greet', target: 'n_menu' },
    { id: 'e3', source: 'n_menu', target: 'n_waste_menu', sourceHandle: 'bm1' },
    { id: 'e4', source: 'n_menu', target: 'n_handoff', sourceHandle: 'bm8' },
    { id: 'e4b', source: 'n_waste_menu', target: 'n_addr08', sourceHandle: 'w1' },
    { id: 'e4c', source: 'n_waste_menu', target: 'n_menu', sourceHandle: 'w5' },
    { id: 'e5', source: 'n_addr08', target: 'n_city' },
    { id: 'e6', source: 'n_city', target: 'n_street', sourceHandle: 'cb1' },
    { id: 'e7', source: 'n_city', target: 'n_city_other', sourceHandle: 'cb6' },
    { id: 'e8', source: 'n_city', target: 'n_menu', sourceHandle: 'cb7' },
    { id: 'e9', source: 'n_city_other', target: 'n_street' },
    { id: 'e10', source: 'n_street', target: 'n_order_date' },
    { id: 'e11', source: 'n_order_date', target: 'n_order_phone' },
    { id: 'e12', source: 'n_order_phone', target: 'n_delay_order' },
    { id: 'e13', source: 'n_delay_order', target: 'n_order_done' },
    { id: 'e14', source: 'n_order_done', target: 'n_end' },
    { id: 'e15', source: 'n_handoff', target: 'n_end' },
  ],
});

async function send(channelId: string, externalUserId: string, text: string, key: string) {
  return processInbound(channelId, {
    externalId: `chat-${externalUserId}`,
    externalUserId,
    text,
    externalKey: `${marker}-${key}`,
  });
}

(async () => {
  // ─── Подготовка: тестовый пользователь/бот/канал ───
  const owner = await db.user.create({
    data: {
      username: marker,
      password: 'x',
      name: 'E2E City Close',
    },
  });
  const bot = await db.bot.create({
    data: { userId: owner.id, name: `E2E ${marker}`, flow: BOT_FLOW, status: 'published' },
  });
  const channel = await db.channel.create({
    data: { botId: bot.id, type: 'web', title: 'e2e-web', active: true },
  });

  const uid1 = `user-1-${marker}`;

  // ─── 1. Путь заявки с выбором города кнопкой ───
  let r = await send(channel.id, uid1, '/start', 's1');
  check('старт → главное меню', r.ok && r.messages.some((m) => m.text.includes('Главное меню')));

  r = await send(channel.id, uid1, '🚛 Заказать вывоз отходов', 's2');
  check('ветка вывоза → выбор контейнера', r.ok && r.messages.some((m) => m.text.includes('Какой контейнер')));

  r = await send(channel.id, uid1, '🛢 0,8 м³ (стандарт)', 's2b');
  check('контейнер выбран → сообщение о городе', r.ok && r.messages.some((m) => m.text.includes('выберите ваш город')));

  r = await send(channel.id, uid1, 'Великий Новгород', 's3');
  check(
    'город принят → вопрос улицы с подстановкой города',
    r.ok && r.messages.some((m) => m.text.includes('Великий Новгород') && m.text.includes('улицу'))
  );

  r = await send(channel.id, uid1, 'улица Большая Санкт-Петербургская, 41', 's4');
  check('улица принята → вопрос даты', r.ok && r.messages.some((m) => m.text.includes('дату')));

  r = await send(channel.id, uid1, 'завтра до 12:00', 's5');
  check('дата принята → вопрос телефона', r.ok && r.messages.some((m) => m.text.includes('телефон')));

  r = await send(channel.id, uid1, '+7 900 111-22-33', 's6');
  const doneMsg = r.ok ? r.messages.map((m) => m.text).join(' ') : '';
  check('заявка принята с номером', r.ok && /№\d+/.test(doneMsg), doneMsg.slice(0, 80));

  // Заявка в БД: город, полный адрес, координаты сразу
  const order = await db.order.findFirst({
    where: { botId: bot.id, externalUserId: uid1 },
    orderBy: { createdAt: 'desc' },
  });
  check('заявка создана', !!order);
  check(
    'город сохранён',
    order?.city === 'Великий Новгород',
    `city=${order?.city}`
  );
  check(
    'полный адрес «город, улица»',
    order?.address === 'Великий Новгород, улица Большая Санкт-Петербургская, 41',
    `address=${order?.address}`
  );
  check('объём (контейнер) сохранён из меню', !!order?.size && order.size.includes('0,8'), `size=${order?.size}`);
  check(
    'координаты стоят сразу (геокинг при создании)',
    order?.lat != null && order?.lng != null,
    `lat=${order?.lat} lng=${order?.lng}`
  );
  check(
    'координаты в Великом Новгороде (широта ~58.5)',
    order?.lat != null && order.lat > 58 && order.lat < 59.2 && order.lng > 30 && order.lng < 32.5,
    `lat=${order?.lat} lng=${order?.lng}`
  );
  check('источник координат — geocode', order?.geoSource === 'geocode', `geoSource=${order?.geoSource}`);

  // ─── 2. Выбор города «Другой город» (свободный ввод) ───
  const uid2 = `user-2-${marker}`;
  await send(channel.id, uid2, '/start', 't1');
  await send(channel.id, uid2, '🚛 Заказать вывоз отходов', 't2');
  await send(channel.id, uid2, '🛢 0,8 м³ (стандарт)', 't2b');
  let r2 = await send(channel.id, uid2, '🌍 Другой город', 't3');
  check(
    '«Другой город» → вопрос города текстом',
    r2.ok && r2.messages.some((m) => m.text.includes('Напишите название вашего города'))
  );
  r2 = await send(channel.id, uid2, 'Чудово', 't4');
  check(
    'город введён вручную → вопрос улицы с ним',
    r2.ok && r2.messages.some((m) => m.text.includes('Чудово') && m.text.includes('улицу'))
  );
  await send(channel.id, uid2, 'ул. Московская, 5', 't5');
  await send(channel.id, uid2, 'завтра', 't6');
  await send(channel.id, uid2, '+7 900 555-66-77', 't7');
  const order2 = await db.order.findFirst({
    where: { botId: bot.id, externalUserId: uid2 },
    orderBy: { createdAt: 'desc' },
  });
  check(
    'ручной город сохранён + адрес собран',
    order2?.city === 'Чудово' && order2?.address === 'Чудово, ул. Московская, 5',
    `city=${order2?.city} address=${order2?.address}`
  );

  // ─── 3. Оператор → закрытие → главное меню с кнопками ───
  const uid3 = `user-3-${marker}`;
  await send(channel.id, uid3, '/start', 'h1');
  await send(channel.id, uid3, '👤 Оператор', 'h2');
  let conv = await db.conversation.findFirst({
    where: { botId: bot.id, externalUserId: uid3 },
  });
  check('handoff: needsOperator', !!conv?.needsOperator);

  // Клик «👥 Оператор» в режиме оператора — бот молчит
  const silent = await send(channel.id, uid3, 'привет, помогите', 'h3');
  check('в режиме оператора бот молчит', silent.ok && silent.messages.length === 0);

  // Закрытие через реальный close-роут (с Bearer-сессией владельца)
  const session = await createSession(owner.id);
  const req = new NextRequest(`http://localhost/api/conversations/${conv!.id}/close`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session.id}` },
  });
  const closeRes = await closePOST(req, { params: Promise.resolve({ id: conv!.id }) });
  const closeJson = (await closeRes.json()) as { ok?: boolean };
  check('close-роут ответил ok', closeRes.status === 200 && closeJson.ok === true);

  conv = await db.conversation.findFirst({ where: { id: conv!.id } });
  check('needsOperator снят', conv?.needsOperator === false);
  const convState = conv?.state ? JSON.parse(conv.state) : null;
  check(
    'состояние ожидает кнопки главного меню',
    convState?.waiting === 'buttons' && convState?.currentNodeId === 'n_menu',
    JSON.stringify(convState?.waiting)
  );

  // Пользователю доставлены «закрыто» + меню с кнопками
  const lastBot = await db.message.findMany({
    where: { conversationId: conv!.id, role: 'bot' },
    orderBy: { createdAt: 'asc' },
  });
  const tail = lastBot.slice(-2).map((m) => m.text);
  check(
    'сообщение о закрытии записано',
    tail.some((t) => t.includes('Обращение закрыто')),
    tail.join(' | ').slice(0, 100)
  );
  check(
    'главное меню доставлено после закрытия',
    tail.some((t) => t.includes('Главное меню')),
    tail.join(' | ').slice(0, 100)
  );

  // Кнопка меню после закрытия продолжает сценарий (не уходит в ИИ)
  const after = await send(channel.id, uid3, '🚛 Заказать вывоз отходов', 'h4');
  check(
    'клик по кнопке меню после закрытия работает',
    after.ok && after.messages.some((m) => m.text.includes('Какой контейнер')),
    after.ok ? after.messages.map((m) => m.text).join('|').slice(0, 100) : String(after)
  );

  // Дальше сценарий ведёт к выбору города
  const after2 = await send(channel.id, uid3, '🛢 0,8 м³ (стандарт)', 'h4b');
  check(
    'после закрытия сценарий полностью работает (шаг города)',
    after2.ok && after2.messages.some((m) => m.text.includes('выберите ваш город')),
    after2.ok ? after2.messages.map((m) => m.text).join('|').slice(0, 100) : String(after2)
  );

  // «📦 Мои заявки» после закрытия показывает список заявок
  await send(channel.id, uid3, '↩️ В главное меню', 'h5');
  const ordersView = await send(channel.id, uid3, '📦 Мои заявки', 'h6');
  check(
    '«Мои заявки» работает после закрытия',
    ordersView.ok && ordersView.messages.some((m) => m.text.includes('Ваши заявки') || m.text.includes('нет заявок')),
    ordersView.ok ? ordersView.messages.map((m) => m.text).join('|').slice(0, 100) : String(ordersView)
  );

  // ─── Очистка ───
  await db.bot.delete({ where: { id: bot.id } });
  await db.user.delete({ where: { id: owner.id } });
  await db.session.delete({ where: { id: session.id } }).catch(() => {});

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

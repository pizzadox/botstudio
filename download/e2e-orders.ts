/**
 * E2E: заявки в боте «Экосити» (через реальный processInbound, temp web-канал).
 * Проверки: анкета при первом обращении (имя+телефон с валидацией), выбор города,
 * адрес с автопроверкой (геокодинг) и «пропустить», дата/время КНОПКАМИ,
 * телефон не спрашивается повторно, создание заявки, «Мои заявки», чат по заявке,
 * режимы, постоянное «🏠 Главное меню».
 * Запуск: bun download/e2e-orders.ts
 */
import { db } from '@/lib/db';
import { processInbound } from '@/lib/webhook';

const EXT_USER = 'e2e-orders-user';
const EXT_CHAT = 'e2e-orders-chat-1';
let pass = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function send(channelId: string, text: string) {
  return processInbound(channelId, {
    externalId: EXT_CHAT,
    externalUserId: EXT_USER,
    text,
    contact: 'E2E Заказы',
  });
}

function lastButtons(res: Extract<Awaited<ReturnType<typeof processInbound>>, { ok: true }>) {
  const msgs = res.messages;
  return msgs.length ? msgs[msgs.length - 1].buttons ?? [] : [];
}

async function main() {
  const bot = await db.bot.findFirst({ where: { user: { username: 'pizzadox' } } });
  if (!bot) throw new Error('Бот не найден');
  console.log('BOT:', bot.name);

  // ── cleanup до и после ──
  const cleanup = async () => {
    await db.order.deleteMany({
      where: { botId: bot.id, externalUserId: { in: [EXT_USER, 'e2e-orders-user-2'] } },
    });
    await db.conversation.deleteMany({
      where: { botId: bot.id, externalUserId: { in: [EXT_USER, 'e2e-orders-user-2'] } },
    });
    await db.channel.deleteMany({ where: { botId: bot.id, title: 'e2e-orders' } });
  };
  await cleanup();

  const channel = await db.channel.create({
    data: {
      botId: bot.id,
      type: 'web',
      title: 'e2e-orders',
      secret: 'e2e-orders-secret',
      active: true,
    },
  });

  try {
    // 1. /start → приветствие → анкета: ИМЯ
    console.log('\n[1] Первое обращение: имя и телефон с валидацией');
    let r = await send(channel.id, '/start');
    check(
      'приветствие → вопрос ИМЕНИ',
      r.ok && r.messages.some((m) => m.text.includes('Как вас зовут')),
      r.ok ? r.messages.map((m) => m.text).join('|').slice(0, 120) : String(r)
    );

    r = await send(channel.id, 'Алексей');
    check(
      'имя принят → вопрос ТЕЛЕФОНА',
      r.ok && r.messages.some((m) => m.text.includes('телефон') && m.text.includes('Алексей')),
      r.ok ? r.messages.map((m) => m.text).join('|').slice(0, 120) : String(r)
    );

    r = await send(channel.id, '123');
    check(
      'короткий телефон → переспрос (валидация)',
      r.ok && r.messages.some((m) => m.text.includes('некорректно')),
      r.ok ? r.messages.map((m) => m.text).join('|').slice(0, 120) : String(r)
    );

    r = await send(channel.id, '+7 999 111-22-33');
    check(
      'валидный телефон → главное меню',
      r.ok && lastButtons(r).length >= 7,
      `кнопок: ${lastButtons(r).length}`
    );

    // 2. Оформление заявки на вывоз
    console.log('\n[2] Оформление заявки (город → адрес с проверкой → дата/время кнопками)');
    r = await send(channel.id, '🚛 Заказать вывоз отходов');
    check('интро вывоза', r.ok && r.messages.some((m) => m.text.includes('Заявка на вывоз отходов')));

    r = await send(channel.id, '🗑 8 м³ (бункер)');
    check('выбор города', r.ok && r.messages.some((m) => m.text.includes('выберите ваш город')));

    r = await send(channel.id, 'Великий Новгород');
    check(
      'вопрос улицы (город подставлен)',
      r.ok && r.messages.some((m) => m.text.includes('Великий Новгород') && m.text.includes('улицу'))
    );

    r = await send(channel.id, 'ххх 000');
    check(
      'несуществующий адрес → переспрос (автопроверка)',
      r.ok && r.messages.some((m) => m.text.includes('Не нашёл такой адрес')),
      r.ok ? r.messages.map((m) => m.text).join('|').slice(0, 120) : String(r)
    );

    r = await send(channel.id, 'Большая Санкт-Петербургская улица, 25');
    check(
      'адрес прошёл проверку → кнопки ДАТЫ',
      r.ok && lastButtons(r).some((b) => b.text.includes('Завтра')),
      JSON.stringify(lastButtons(r).map((b) => b.text))
    );

    r = await send(channel.id, 'Завтра');
    check(
      'дата кнопкой → кнопки ВРЕМЕНИ',
      r.ok && lastButtons(r).some((b) => b.text.includes('Утро')),
      JSON.stringify(lastButtons(r).map((b) => b.text))
    );

    r = await send(channel.id, '🌅 Утро (9:00–12:00)');
    const doneText = r.ok ? r.messages.map((m) => m.text).join('\n') : '';
    check('сводка с номером заявки', /№\d+/.test(doneText), doneText.slice(0, 160));
    check(
      'телефон НЕ спрашивается повторно (известен из анкеты)',
      !doneText.includes('Оставьте контактный телефон'),
      doneText.slice(0, 160)
    );
    const numMatch = doneText.match(/№(\d+)/);
    const orderNum = numMatch ? parseInt(numMatch[1], 10) : NaN;
    check('номер — реальное число', Number.isFinite(orderNum));

    const created = await db.order.findFirst({
      where: { botId: bot.id, externalUserId: EXT_USER },
    });
    check('заявка создана в БД', !!created);
    check(
      'данные: имя из анкеты, город, полный адрес, дата с временем',
      !!created &&
        created.clientName === 'Алексей' &&
        created.phone?.includes('999') &&
        created.city === 'Великий Новгород' &&
        (created.address ?? '').includes('Великий Новгород, Большая Санкт-Петербургская') &&
        (created.wishDate ?? '').includes('Завтра') &&
        (created.wishDate ?? '').includes('Утро'),
      created ? JSON.stringify(created) : 'нет заявки'
    );
    check(
      'координаты поставлены сразу (геокинг при создании)',
      !!created && created.lat != null && created.lng != null && created.geoSource === 'geocode',
      created ? `lat=${created.lat} geo=${created.geoSource}` : 'нет заявки'
    );

    // 3. Второй пользователь: «пропустить» и повторный вопрос телефона
    console.log('\n[3] Пропуск проверки и повторный вопрос телефона');
    const r2 = await processInbound(channel.id, {
      externalId: 'e2e-orders-chat-2',
      externalUserId: 'e2e-orders-user-2',
      text: '/start',
      contact: 'E2E Второй',
    });
    check('старт → имя', r2.ok && r2.messages.some((m) => m.text.includes('Как вас зовут')));
    await processInbound(channel.id, {
      externalId: 'e2e-orders-chat-2',
      externalUserId: 'e2e-orders-user-2',
      text: 'Мария',
    });
    let r3 = await processInbound(channel.id, {
      externalId: 'e2e-orders-chat-2',
      externalUserId: 'e2e-orders-user-2',
      text: 'пропустить',
    });
    check(
      '«пропустить» принимает телефон без проверки → меню',
      r3.ok && lastButtons(r3).length >= 7,
      r3.ok ? r3.messages.map((m) => m.text).join('|').slice(0, 100) : String(r3)
    );
    await processInbound(channel.id, {
      externalId: 'e2e-orders-chat-2',
      externalUserId: 'e2e-orders-user-2',
      text: '🚛 Заказать вывоз отходов',
    });
    await processInbound(channel.id, {
      externalId: 'e2e-orders-chat-2',
      externalUserId: 'e2e-orders-user-2',
      text: '🛢 0,8 м³ (стандарт)',
    });
    await processInbound(channel.id, {
      externalId: 'e2e-orders-chat-2',
      externalUserId: 'e2e-orders-user-2',
      text: 'Боровичи',
    });
    r3 = await processInbound(channel.id, {
      externalId: 'e2e-orders-chat-2',
      externalUserId: 'e2e-orders-user-2',
      text: 'пропустить',
    });
    check(
      '«пропустить» работает и для адреса → кнопки даты',
      r3.ok && lastButtons(r3).some((b) => b.text.includes('Сегодня')),
      r3.ok ? r3.messages.map((m) => m.text).join('|').slice(0, 100) : String(r3)
    );
    await processInbound(channel.id, {
      externalId: 'e2e-orders-chat-2',
      externalUserId: 'e2e-orders-user-2',
      text: 'Сегодня',
    });
    r3 = await processInbound(channel.id, {
      externalId: 'e2e-orders-chat-2',
      externalUserId: 'e2e-orders-user-2',
      text: '⏰ Точное время',
    });
    check(
      '«Точное время» → свободный ввод',
      r3.ok && r3.messages.some((m) => m.text.includes('Укажите удобное время')),
      r3.ok ? r3.messages.map((m) => m.text).join('|').slice(0, 100) : String(r3)
    );
    r3 = await processInbound(channel.id, {
      externalId: 'e2e-orders-chat-2',
      externalUserId: 'e2e-orders-user-2',
      text: '14:30',
    });
    check(
      'телефон не был оставлен → переспрос в заявке',
      r3.ok && r3.messages.some((m) => m.text.includes('контактный телефон')),
      r3.ok ? r3.messages.map((m) => m.text).join('|').slice(0, 100) : String(r3)
    );
    r3 = await processInbound(channel.id, {
      externalId: 'e2e-orders-chat-2',
      externalUserId: 'e2e-orders-user-2',
      text: '+7 905 777-88-99',
    });
    const order2 = await db.order.findFirst({
      where: { botId: bot.id, externalUserId: 'e2e-orders-user-2' },
    });
    check(
      'заявка 2: дата с точным временем, телефон из ветки',
      !!order2 &&
        (order2.wishDate ?? '').includes('Сегодня') &&
        (order2.wishDate ?? '').includes('14:30') &&
        order2.phone?.includes('905'),
      order2 ? JSON.stringify(order2) : 'нет заявки'
    );

    // 4. «📦 Мои заявки» → список (первый пользователь)
    console.log('\n[4] Мои заявки');
    r = await send(channel.id, '🏠 Главное меню');
    check('главное меню', r.ok && lastButtons(r).length >= 7);
    r = await send(channel.id, '📦 Мои заявки');
    const listText = r.ok ? r.messages.map((m) => m.text).join('\n') : '';
    check(
      'список с номером заявки',
      listText.includes(`№${orderNum}`) || lastButtons(r).some((b) => b.text.includes(`№${orderNum}`))
    );
    const orderBtn = lastButtons(r).find((b) => b.text.includes(`№${orderNum}`));
    check('кнопка заявки в списке', !!orderBtn);

    // 5. Карточка заявки
    console.log('\n[5] Карточка заявки в боте');
    r = await send(channel.id, orderBtn ? orderBtn.text : `№${orderNum}`);
    const cardText = r.ok ? r.messages.map((m) => m.text).join('\n') : '';
    check('карточка с номером', cardText.includes(`Заявка №${orderNum}`));
    check(
      'кнопки переключения режимов',
      lastButtons(r).some((b) => b.text.includes('Позвать оператора')) &&
        lastButtons(r).some((b) => b.text.includes('Свободный чат'))
    );

    // 6. Чат по заявке
    console.log('\n[6] Чат по заявке');
    r = await send(channel.id, 'Когда приедет машина?');
    check('бот молчит (сообщение оператору)', r.ok && r.messages.length === 0);
    const orderMsg = await db.message.findFirst({
      where: { orderId: created!.id, role: 'user', text: 'Когда приедет машина?' },
    });
    check('сообщение привязано к заявке (orderId)', !!orderMsg);

    // 7. Свободный чат с ИИ
    console.log('\n[7] Свободный чат (ИИ)');
    r = await send(channel.id, '💬 Свободный чат');
    check('переход в свободный чат', r.ok && r.messages.some((m) => m.text.includes('Свободный чат')));
    r = await send(channel.id, 'Во сколько вывозите мусор в частном секторе?');
    const aiText = r.ok ? r.messages.map((m) => m.text).join(' ') : '';
    check('ИИ ответил в свободном чате', aiText.length > 20, aiText.slice(0, 80));

    // 8. Оператор
    console.log('\n[8] Оператор');
    r = await send(channel.id, '🎧 Позвать оператора');
    check('передача оператору', r.ok && r.needsOperator === true);
    r = await send(channel.id, 'алло, кто-нибудь?');
    check('в режиме оператора бот молчит', r.ok && r.messages.length === 0);
  } finally {
    await cleanup();
    console.log('\ncleanup ✓');
  }

  console.log(`\n════════ Итог: ${pass} ✅ / ${failures.length} ❌`);
  if (failures.length) {
    console.log('Провалены:', failures.join(' | '));
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

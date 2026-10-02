/**
 * E2E: заявки в боте «Экосити» (через реальный processInbound, temp web-канал).
 * Проверки: создание заявки с номером, «Мои заявки», чат по заявке (orderId),
 * режимы (заявки/оператор/свободный чат), постоянное «🏠 Главное меню».
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
    await db.order.deleteMany({ where: { botId: bot.id, externalUserId: EXT_USER } });
    await db.conversation.deleteMany({ where: { botId: bot.id, externalUserId: EXT_USER } });
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
    // 1. /start → меню
    console.log('\n[1] /start → главное меню');
    let r = await send(channel.id, '/start');
    check('старт ответил', r.ok && r.messages.length >= 2);
    const menuBtns = lastButtons(r);
    check('меню из 8 кнопок', menuBtns.length === 8, `получено ${menuBtns.length}`);

    // 2. Оформление заявки на вывоз
    console.log('\n[2] Оформление заявки (вывоз 8 м³)');
    r = await send(channel.id, '🚛 Заказать вывоз отходов');
    check('интро вывоза', r.ok && r.messages.some((m) => m.text.includes('Заявка на вывоз отходов')));
    const navBtns = lastButtons(r);
    check(
      'постоянные кнопки добавлены',
      navBtns.some((b) => b.text.includes('Мои заявки')) &&
        navBtns.some((b) => b.text.includes('Главное меню')),
      JSON.stringify(navBtns.map((b) => b.text))
    );

    r = await send(channel.id, '🗑 8 м³ (бункер)');
    check('вопрос адреса', r.ok && r.messages.some((m) => m.text.includes('адрес вывоза')));

    r = await send(channel.id, 'Москва, Ленинградский проспект, 30');
    check('вопрос даты', r.ok && r.messages.some((m) => m.text.includes('дату подать')));

    r = await send(channel.id, 'завтра до 12:00');
    check('вопрос телефона', r.ok && r.messages.some((m) => m.text.includes('телефон')));

    r = await send(channel.id, '+7 999 111-22-33');
    const doneText = r.ok ? r.messages.map((m) => m.text).join('\n') : '';
    check('сводка с номером заявки', /Номер заявки:\s*№\d+/.test(doneText), doneText.slice(0, 200));
    const numMatch = doneText.match(/№(\d+)/);
    const orderNum = numMatch ? parseInt(numMatch[1], 10) : NaN;
    check('номер — реальное число', Number.isFinite(orderNum));

    const created = await db.order.findFirst({
      where: { botId: bot.id, externalUserId: EXT_USER },
    });
    check('заявка создана в БД', !!created);
    check(
      'данные заявки заполнены',
      !!created &&
        created.type === 'waste' &&
        (created.size ?? '').includes('8 м³') &&
        (created.address ?? '').includes('Ленинградский') &&
        (created.phone ?? '').includes('999'),
      created ? JSON.stringify(created) : 'нет заявки'
    );
    check(
      'статус новая',
      !!created && created.status === 'new'
    );

    // 3. «📦 Мои заявки» → список
    console.log('\n[3] Мои заявки');
    r = await send(channel.id, '📦 Мои заявки');
    const listText = r.ok ? r.messages.map((m) => m.text).join('\n') : '';
    check('список с номером заявки', listText.includes(`№${orderNum}`) || lastButtons(r).some((b) => b.text.includes(`№${orderNum}`)));
    const orderBtn = lastButtons(r).find((b) => b.text.includes(`№${orderNum}`));
    check('кнопка заявки в списке', !!orderBtn);

    // 4. Открыть карточку заявки
    console.log('\n[4] Карточка заявки в боте');
    r = await send(channel.id, orderBtn ? orderBtn.text : `№${orderNum}`);
    const cardText = r.ok ? r.messages.map((m) => m.text).join('\n') : '';
    check('карточка с номером', cardText.includes(`Заявка №${orderNum}`));
    check(
      'карточка: статус + подсказка про чат',
      cardText.includes('Новая') && cardText.includes('Напишите сообщение')
    );
    check(
      'кнопки переключения режимов',
      lastButtons(r).some((b) => b.text.includes('Позвать оператора')) &&
        lastButtons(r).some((b) => b.text.includes('Свободный чат'))
    );

    // 5. Чат по заявке: сообщение уходит в карточку (orderId), бот молчит
    console.log('\n[5] Чат по заявке');
    r = await send(channel.id, 'Когда приедет машина?');
    check('бот молчит (сообщение оператору)', r.ok && r.messages.length === 0);
    const orderMsg = await db.message.findFirst({
      where: { orderId: created!.id, role: 'user', text: 'Когда приедет машина?' },
    });
    check('сообщение привязано к заявке (orderId)', !!orderMsg);

    // 6. Свободный чат с ИИ
    console.log('\n[6] Свободный чат (ИИ)');
    r = await send(channel.id, '💬 Свободный чат');
    check('переход в свободный чат', r.ok && r.messages.some((m) => m.text.includes('Свободный чат')));
    r = await send(channel.id, 'Во сколько вывозите мусор в частном секторе?');
    const aiText = r.ok ? r.messages.map((m) => m.text).join(' ') : '';
    check('ИИ ответил в свободном чате', aiText.length > 20, aiText.slice(0, 80));
    check('режим чата сохранился (нет меню сценария)', !lastButtons(r).some((b) => b.text.includes('Частый вопрос')));

    // 7. Из свободного чата → Мои заявки → карточка → оператор
    console.log('\n[7] Переключение: чат → заявки → оператор');
    r = await send(channel.id, '📦 Мои заявки');
    check('вернулись к списку заявок', r.ok && lastButtons(r).some((b) => b.text.includes(`№${orderNum}`)));
    r = await send(channel.id, `№${orderNum} · Вывоз отходов · Новая`);
    check('карточка открыта снова', r.ok && r.messages.some((m) => m.text.includes(`Заявка №${orderNum}`)));
    r = await send(channel.id, '🎧 Позвать оператора');
    check('передача оператору', r.ok && r.needsOperator === true);
    r = await send(channel.id, 'алло, кто-нибудь?');
    check('в режиме оператора бот молчит', r.ok && r.messages.length === 0);

    // 8. Закрытие обращения → «🏠 Главное меню» перезапускает сценарий
    console.log('\n[8] Главное меню после закрытия обращения');
    const conv = await db.conversation.findFirst({
      where: { botId: bot.id, externalUserId: EXT_USER },
    });
    check('диалог один на все режимы', !!conv && conv.source === 'web');
    if (conv) {
      const st = conv.state ? JSON.parse(conv.state) : { vars: {} };
      delete st.vars['__operator'];
      delete st.vars['__mode'];
      st.waiting = 'none';
      st.currentNodeId = null;
      await db.conversation.update({
        where: { id: conv.id },
        data: { needsOperator: false, state: JSON.stringify(st) },
      });
    }
    r = await send(channel.id, '🏠 Главное меню');
    check(
      'главное меню — приветствие + 8 кнопок',
      r.ok && lastButtons(r).length === 8,
      `кнопок: ${lastButtons(r).length}`
    );

    // 9. Пользователь без заявок видит заглушку
    console.log('\n[9] Пользователь без заявок');
    const r2 = await processInbound(channel.id, {
      externalId: 'e2e-orders-chat-2',
      externalUserId: 'e2e-orders-user-2',
      text: '📦 Мои зая…'.replace('…', 'вки'),
      contact: 'E2E Второй',
    });
    check(
      'заглушка «нет заявок» + кнопки заказа',
      r2.ok &&
        r2.messages.some((m) => m.text.includes('пока нет заявок')) &&
        lastButtons(r2).some((b) => b.text.includes('Заказать вывоз'))
    );
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

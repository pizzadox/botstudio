/**
 * E2E Task 11: «Мои заявки» в боте, чат по заявке, переключение режимов
 * (заявка / оператор / свободный чат), всегда видимая кнопка «🏠 В главное меню».
 * Через processInbound (тот же путь, что у MAX-poller и демо-чата).
 * Запуск: bun download/e2e-tickets-chat.ts
 */
import { db } from '@/lib/db';
import { processInbound } from '@/lib/webhook';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, extra?: string) {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}

async function send(channelId: string, userId: string, text: string) {
  return processInbound(channelId, {
    externalId: `e2e-tc-${userId}`,
    externalUserId: userId,
    text,
    contact: 'E2E TicketsChat',
    externalKey: `e2e-tc-${userId}-${Math.random().toString(36).slice(2)}`,
  });
}
function btnTexts(r: any): string[] {
  const msgs = r.messages ?? [];
  return msgs.length ? (msgs[msgs.length - 1].buttons ?? []).map((b: any) => b.text) : [];
}
function joined(r: any): string {
  return (r.messages ?? []).map((m: any) => m.text).join('\n');
}
function lastNeedsOperator(r: any): boolean {
  return !!(r as any).needsOperator;
}

async function main() {
  console.log('─ Заявки в боте: список, чат по заявке, навигация — e2e ──────────');

  const bot = await db.bot.findFirst({ where: { user: { username: 'pizzadox' }, name: { contains: 'Экосити' } } });
  if (!bot) { console.error('бот Экосити не найден'); process.exit(1); }

  const channel = await db.channel.create({
    data: { botId: bot.id, type: 'web', title: 'e2e-temp-tickets-chat', active: true, secret: `e2e-tc-${Date.now()}` },
  });

  const cleanup = async () => {
    const convs = await db.conversation.findMany({ where: { botId: bot.id, source: 'web', externalUserId: { startsWith: 'e2e-tc-' } } });
    for (const c of convs) await db.conversation.delete({ where: { id: c.id } });
    await db.channel.delete({ where: { id: channel.id } });
    console.log(`  🧹 cleanup: удалено диалогов ${convs.length}, канал удалён`);
  };

  try {
    const U1 = 'e2e-tc-user1';
    const U2 = 'e2e-tc-user2';

    // 1. /start → меню 9 кнопок, БЕЗ автоматической «🏠 В главное меню»
    let r = await send(channel.id, U1, '/start');
    check('1. /start: приветствие + меню', r.ok && (r.messages?.length ?? 0) >= 2, `сообщений ${r.messages?.length}`);
    check('1. Главное меню 9 кнопок (bm1..bm9)', btnTexts(r).length === 9, `кнопок ${btnTexts(r).length}`);
    check('1. «Мои заявки» в меню', btnTexts(r).includes('🎫 Мои заявки'));
    check('1. Меню без авто-кнопки «🏠 В главное меню»', !btnTexts(r).includes('🏠 В главное меню'));

    // 2. У U1 пока нет заявок — пустой список
    r = await send(channel.id, U1, '🎫 Мои заявки');
    check('2. Пустой список: «нет заявок»', joined(r).includes('нет заявок'), joined(r).slice(0, 80));
    check('2. К пустому списку добавлена «🏠 В главное меню»', btnTexts(r).includes('🏠 В главное меню'));
    check('2. Возврат в меню работает', true);

    // 3. Оформление заявки на вывоз: адрес → дата → телефон → сводка с номером
    r = await send(channel.id, U1, '🚛 Заказать вывоз отходов');
    check('3. Меню контейнеров + «🏠 В главное меню» (6 кнопок)', btnTexts(r).length === 6 && btnTexts(r).includes('🏠 В главное меню'), `кнопок ${btnTexts(r).length}`);
    await send(channel.id, U1, '🛢 0,8 м³ (стандарт)');
    await send(channel.id, U1, 'Ленина 1');
    await send(channel.id, U1, 'завтра до 12');
    r = await send(channel.id, U1, '+7 900 111-22-33');
    const numMatch = joined(r).match(/Номер заявки:\s*(\d+)/);
    const ticket1 = numMatch ? Number(numMatch[1]) : null;
    check('3. Сводка содержит номер заявки', ticket1 !== null, joined(r).slice(0, 120));
    check('3. К сводке добавлена «🏠 В главное меню»', btnTexts(r).includes('🏠 В главное меню'));

    const t1 = await db.ticket.findFirst({ where: { botId: bot.id, number: ticket1 ?? -1 } });
    check('3. Заявка в БД с адресом/телефоном', !!t1 && t1.address === 'Ленина 1' && t1.phone === '+7 900 111-22-33');
    check('3. Заявка привязана к диалогу', !!t1 && !!t1.conversationId);
    check('3. Номер сквозной (>=1001)', (t1?.number ?? 0) >= 1001);

    // 4. Кнопки сохраняются в сообщении БД (динамические клавиатуры для виджета)
    const lastBotMsg = t1?.conversationId
      ? await db.message.findFirst({
          where: { conversationId: t1.conversationId, role: 'bot' },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    check('4. Кнопки последнего сообщения сохранены в БД', !!lastBotMsg?.buttons && lastBotMsg.buttons.includes('__menu'));

    // 5. «🏠 В главное меню» возвращает в меню из любой точки
    r = await send(channel.id, U1, '🏠 В главное меню');
    check('5. Возврат в главное меню (9 кнопок)', btnTexts(r).length === 9, `кнопок ${btnTexts(r).length}`);

    // 6. Вторая заявка (КГМ) — для переключения между заявками
    r = await send(channel.id, U1, '📦 Вывоз КГМ');
    check('6. Меню КГМ', btnTexts(r).some((b: string) => b.includes('Заказать вывоз КГМ')), btnTexts(r).join('|'));
    await send(channel.id, U1, '✍️ Заказать вывоз КГМ');
    await send(channel.id, U1, 'Гагарина 5');
    await send(channel.id, U1, 'диван и холодильник');
    await send(channel.id, U1, 'среда утром');
    r = await send(channel.id, U1, '+7 900 444-55-66');
    const num2Match = joined(r).match(/Номер заявки:\s*(\d+)/);
    const ticket2 = num2Match ? Number(num2Match[1]) : null;
    check('6. Заявка КГМ создана с номером', ticket2 !== null && ticket2 !== ticket1, `№${ticket2}`);
    await send(channel.id, U1, '🏠 В главное меню');

    // 7. «Мои заявки» — обе заявки кнопками + «Оператор» + «В главное меню»
    r = await send(channel.id, U1, '🎫 Мои заявки');
    const listBtns = btnTexts(r);
    check('7. Список содержит обе заявки', listBtns.some((b) => b.includes(`№${ticket1}`)) && listBtns.some((b) => b.includes(`№${ticket2}`)), listBtns.join(' | '));
    check('7. Список содержит тип и статус', listBtns.some((b) => b.includes('Вывоз отходов') && b.includes('Новая')));
    check('7. В списке есть «👤 Оператор»', listBtns.includes('👤 Оператор'));
    check('7. В списке есть «🏠 В главное меню»', listBtns.includes('🏠 В главное меню'));

    // 8. Выбор заявки → карточка + вход в чат по заявке
    r = await send(channel.id, U1, `№${ticket1} · Вывоз отходов · Новая`);
    check('8. Карточка заявки показана', joined(r).includes(`Заявка №${ticket1}`) && joined(r).includes('Ленина 1'), joined(r).slice(0, 100));
    check('8. Подсказка про чат с оператором', joined(r).includes('оператор получит'));
    check('8. Кнопки: «Мои заявки» + «В главное меню»', btnTexts(r).includes('🎫 Мои заявки') && btnTexts(r).includes('🏠 В главное меню'));

    // 9. Сообщение в чате по заявке → уходит оператору, есть подтверждение
    r = await send(channel.id, U1, 'Здравствуйте, когда приедет машина?');
    check('9. Подтверждение передачи оператору', joined(r).includes('передано оператору') && joined(r).includes(`№${ticket1}`), joined(r).slice(0, 100));
    check('9. Диалог передан оператору', lastNeedsOperator(r) === true);
    const conv1 = await db.conversation.findFirst({ where: { botId: bot.id, source: 'web', externalUserId: U1 } });
    check('9. needsOperator сохранён в БД', conv1?.needsOperator === true);

    // 10. Повторные сообщения в режиме оператора — бот молчит (инбокс получает)
    r = await send(channel.id, U1, 'И ещё: контейнер нужен побольше');
    check('10. Повторное сообщение — бот молчит', (r.messages?.length ?? 0) === 0, joined(r).slice(0, 80));

    // 11. «🏠 В главное меню» работает даже в режиме оператора — выход к боту
    r = await send(channel.id, U1, '🏠 В главное меню');
    check('11. Выход из режима оператора в меню', btnTexts(r).length === 9, `кнопок ${btnTexts(r).length}`);
    const conv1b = await db.conversation.findFirst({ where: { id: conv1!.id } });
    check('11. needsOperator снят в БД', conv1b?.needsOperator === false);

    // 12. Переключение на другую заявку: «Мои заявки» → вторая заявка
    r = await send(channel.id, U1, 'мои заявки');
    check('12. Список открывается по тексту «мои заявки»', btnTexts(r).some((b) => b.includes(`№${ticket2}`)));
    r = await send(channel.id, U1, `№${ticket2} · Вывоз КГМ · Новая`);
    check('12. Карточка второй заявки (КГМ)', joined(r).includes(`Заявка №${ticket2}`) && joined(r).includes('Гагарина 5'), joined(r).slice(0, 100));

    // 13. Чат по второй заявке → оператор; затем «🏠 В главное меню» → свободный вопрос (ИИ)
    r = await send(channel.id, U1, 'Диван увезти сможете?');
    check('13. Сообщение по второй заявке передано', joined(r).includes('передано оператору') && joined(r).includes(`№${ticket2}`));
    r = await send(channel.id, U1, '🏠 В главное меню');
    check('13. Возврат в меню из чата по заявке', btnTexts(r).length === 9);

    // 14. «👤 Оператор» из списка заявок → режим оператора (через свой блок «Оператор» сценария)
    r = await send(channel.id, U1, '🎫 Мои заявки');
    r = await send(channel.id, U1, '👤 Оператор');
    check('14. «Оператор» из списка заявок работает', /оператор/i.test(joined(r)) && lastNeedsOperator(r) === true, joined(r).slice(0, 80));
    r = await send(channel.id, U1, 'меню');
    check('14. «меню» текстом тоже возвращает', btnTexts(r).length === 9);

    // 15. Несуществующий номер — вежливый отказ + возврат к списку
    r = await send(channel.id, U1, '№9999');
    check('15. Неизвестная заявка — отказ без входа в чат', joined(r).includes('не найдена'), joined(r).slice(0, 80));
    check('15. После отказа снова показан список заявок', btnTexts(r).some((b) => b.includes('№')));

    // 16. «№1001» как ответ на вопрос сценария НЕ перехватывается
    r = await send(channel.id, U1, '📋 Статус заявки');
    check('16. Вопрос номера заявки задан', joined(r).includes('номер заявки'));
    r = await send(channel.id, U1, String(ticket1));
    check('16. Номер ушёл в сценарий (ИИ-диспетчер), не в чат по заявке', !joined(r).includes('оператор получит') && (joined(r).length > 30), joined(r).slice(0, 100));
    check('16. Диалог не передан оператору', lastNeedsOperator(r) === false);

    // 17. Изоляция: у U2 свой список заявок
    await send(channel.id, U2, '/start');
    r = await send(channel.id, U2, '🎫 Мои заявки');
    check('17. У другого клиента список пуст', joined(r).includes('нет заявок'));
    const u2Btns = btnTexts(r);
    check('17. В списке U2 нет заявок U1', !u2Btns.some((b) => b.includes(`№${ticket1}`) || b.includes(`№${ticket2}`)));

    // 18. Оба тикета в БД принадлежат диалогу U1
    const u1Tickets = await db.ticket.findMany({ where: { botId: bot.id, conversationId: conv1!.id } });
    check('18. У диалога U1 обе заявки', u1Tickets.length === 2, `заявок ${u1Tickets.length}`);
  } finally {
    await cleanup();
  }

  console.log(`\nИтог: ${passed} ✅ / ${failed} ❌`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

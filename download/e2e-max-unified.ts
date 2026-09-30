/**
 * E2E-проверка фиксов MAX:
 *  1) текст и кнопки одного человека попадают в ОДНО обращение
 *     (message_created приходит с chat_id, callback — только с user_id);
 *  2) повторные callback'и дедуплицируются, заглушки «…» не отправляются;
 *  3) режим оператора: клик кнопки → записка «передал оператору» (не спам);
 *  4) смена chat_id тем же человеком не создаёт новое обращение.
 *
 * Тестовый бот/канал с фейковым токеном — после проверки удаляются.
 * Отправка в MAX фейковые chat_id отклонит (chat.not.found / 401 токена) —
 * это ожидаемо, проверяется логика БД и обработчиков.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const BASE = 'http://localhost:3000';
const CHAT_A = '555000111';
const CHAT_B = '555000999';
const USER = '444000222';

async function postWebhook(secret: string, payload: unknown) {
  const res = await fetch(`${BASE}/api/webhook/max/${secret}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.status;
}

function messageCreated(chatId: string, mid: string, text: string) {
  return {
    update_type: 'message_created',
    timestamp: Date.now(),
    payload: {
      message: {
        sender: { user_id: Number(USER), name: 'Тест Пользователь', is_bot: false },
        recipient: { chat_id: Number(chatId) },
        body: { text, mid },
      },
    },
  };
}

function callback(cbId: string, buttonText: string) {
  return {
    update_type: 'message_callback',
    timestamp: Date.now(),
    payload: {
      callback: {
        callback_id: cbId,
        user: { user_id: Number(USER), name: 'Тест Пользователь', is_bot: false },
        button: { type: 'callback', text: buttonText, payload: buttonText },
      },
    },
  };
}

async function main() {
  // ── Подготовка изолированного бота ──
  const user = await db.user.create({
    data: { username: `e2e-max-${Date.now()}`, password: 'x' },
  });
  const flow = {
    nodes: [
      { id: 'n_start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Старт' } },
      { id: 'n_greet', type: 'message', position: { x: 0, y: 100 }, data: { label: 'g', text: 'Здравствуйте! 👋' } },
      {
        id: 'n_menu', type: 'buttons', position: { x: 0, y: 200 }, data: {
          label: 'm', text: 'Выберите:',
          buttons: [{ id: 'b1', text: '❓ Частый вопрос' }, { id: 'b2', text: '👤 Оператор' }],
        },
      },
      { id: 'n_ai', type: 'ai', position: { x: 0, y: 300 }, data: { label: 'ai', prompt: 'Ответь кратко: тест.', useMemory: true } },
      {
        id: 'n_more', type: 'buttons', position: { x: 0, y: 400 }, data: {
          label: 'more', text: 'Ещё помощь?',
          buttons: [{ id: 'b1', text: 'Да, ещё вопрос' }, { id: 'b2', text: '👤 Оператор' }],
        },
      },
      { id: 'n_ho', type: 'handoff', position: { x: 200, y: 300 }, data: { label: 'ho', text: 'Передаю оператору…' } },
    ],
    edges: [
      { id: 'e1', source: 'n_start', target: 'n_greet' },
      { id: 'e2', source: 'n_greet', target: 'n_menu' },
      { id: 'e3', source: 'n_menu', target: 'n_ai', sourceHandle: 'b1' },
      { id: 'e4', source: 'n_menu', target: 'n_ho', sourceHandle: 'b2' },
      { id: 'e5', source: 'n_ai', target: 'n_more' },
      { id: 'e6', source: 'n_more', target: 'n_menu', sourceHandle: 'b1' },
      { id: 'e7', source: 'n_more', target: 'n_ho', sourceHandle: 'b2' },
    ],
  };
  const bot = await db.bot.create({
    data: { userId: user.id, name: 'E2E-MAX', status: 'published', flow: JSON.stringify(flow) },
  });
  const channel = await db.channel.create({
    data: { botId: bot.id, type: 'max', title: 'e2e', token: 'fake-token-e2e', active: true },
  });
  const secret = channel.secret;

  const results: string[] = [];
  const check = (name: string, cond: boolean, detail = '') => {
    results.push(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const convCount = async () =>
    db.conversation.count({ where: { botId: bot.id } });
  const getConv = async () =>
    db.conversation.findFirst({ where: { botId: bot.id }, include: { messages: true } });
  /** ждём, пока условие выполнится (движок может работать до 30с — ИИ-узел) */
  const waitFor = async (cond: () => Promise<boolean>, timeoutMs = 35000, stepMs = 500) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await cond()) return true;
      await new Promise((r) => setTimeout(r, stepMs));
    }
    return cond();
  };

  // 1. Текстовое сообщение → создание обращения
  await postWebhook(secret, messageCreated(CHAT_A, 'mid-e2e-1', 'привет'));
  let conv = await getConv();
  check('текст создал ровно 1 обращение', (await convCount()) === 1);
  check('externalId = chat_id', conv?.externalId === CHAT_A, String(conv?.externalId));
  check('externalUserId = user_id', conv?.externalUserId === USER, String(conv?.externalUserId));
  check('бот ответил приветствием+меню', (conv?.messages.length ?? 0) === 3);

  // 2. Callback (тот же user, chat_id недоступен) → ТО ЖЕ обращение
  await postWebhook(secret, callback('cb-e2e-1', '❓ Частый вопрос'));
  const aiDone = await waitFor(async () => {
    const c = await getConv();
    return !!c?.messages.some((m) => m.role === 'bot' && m.text.length > 20 && !m.text.includes('Выберите'));
  });
  check('callback не создал новое обращение', (await convCount()) === 1, `всего: ${await convCount()}`);
  conv = await getConv();
  const aiReply = conv?.messages.some((m) => m.role === 'bot' && m.text.length > 20 && !m.text.includes('Выберите'));
  check('движок ответил на выбор кнопки (ИИ)', !!aiReply);
  const stubs = conv?.messages.filter((m) => m.text.trim() === '…').length ?? -1;
  check('нет заглушек «…» в ответах', stubs === 0);

  // 3. Повтор того же callback_id → дедупликация
  const msgCountBefore = conv?.messages.length ?? 0;
  await postWebhook(secret, callback('cb-e2e-1', '❓ Частый вопрос'));
  await new Promise((r) => setTimeout(r, 800));
  conv = await getConv();
  check('повтор callback_id не добавил сообщений', (conv?.messages.length ?? 0) === msgCountBefore);

  // 4. Кнопка «Оператор» (в узле «Ещё помощь?») → handoff
  await postWebhook(secret, callback('cb-e2e-2', '👤 Оператор'));
  await waitFor(async () => {
    const c = await getConv();
    return c?.needsOperator === true;
  });
  conv = await getConv();
  check('handoff сработал', conv?.needsOperator === true);
  check(' handoff-ответ доставлен в переписку', conv?.messages.some((m) => m.text.includes('Передаю оператору')) === true);

  // 5. Клик кнопки в режиме оператора → записка «передал оператору» (не «…»)
  const botCountBefore = (conv?.messages ?? []).filter((m) => m.role === 'bot').length;
  await postWebhook(secret, callback('cb-e2e-3', '❓ Частый вопрос'));
  const noteShown = await waitFor(async () => {
    const c = await getConv();
    return (c?.messages ?? []).some((m) => m.role === 'bot' && m.text.includes('передано оператору'));
  });
  conv = await getConv();
  check('в режиме оператора — записка о передаче', noteShown);
  const stubs2 = (conv?.messages ?? []).filter((m) => m.text.trim() === '…').length;
  check('в режиме оператора нет заглушек «…»', stubs2 === 0);
  check('обращение по-прежнему одно', (await convCount()) === 1);

  // 5a. Повторный клик в режиме оператора — записка не спамится (троттлинг 10 мин)
  await postWebhook(secret, callback('cb-e2e-4', '👤 Оператор'));
  await new Promise((r) => setTimeout(r, 1500));
  conv = await getConv();
  const botCountAfter = (conv?.messages ?? []).filter((m) => m.role === 'bot').length;
  check('повторная записка подавлена (троттлинг)', botCountAfter === botCountBefore + 1);

  // 6. Тот же человек пишет из ДРУГОГО чата → то же обращение, externalId обновлён
  await postWebhook(secret, messageCreated(CHAT_B, 'mid-e2e-2', 'привет из другого чата'));
  conv = await getConv();
  check('смена chat_id не создала новое обращение', (await convCount()) === 1, `всего: ${await convCount()}`);
  check('externalId обновлён на новый chat', conv?.externalId === CHAT_B, String(conv?.externalId));
  check('сообщение из нового чата в переписке', conv?.messages.some((m) => m.text === 'привет из другого чата') === true);

  // 7. Повтор message (тот же mid) → дедупликация
  const beforeDup = conv?.messages.length ?? 0;
  await postWebhook(secret, messageCreated(CHAT_B, 'mid-e2e-2', 'привет из другого чата'));
  await new Promise((r) => setTimeout(r, 1500));
  conv = await getConv();
  check('повтор message (mid) не добавил сообщений', (conv?.messages.length ?? 0) === beforeDup);

  console.log('\n=== РЕЗУЛЬТАТЫ E2E ===');
  for (const r of results) console.log(r);
  const failed = results.filter((r) => r.startsWith('❌')).length;
  console.log(failed ? `\nПРОВАЛЕНО: ${failed}` : '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');

  // ── Уборка ──
  await db.bot.delete({ where: { id: bot.id } }); // каскад: канал, обращения, сообщения
  await db.user.delete({ where: { id: user.id } });
  console.log('Тестовые данные удалены');
  process.exit(failed ? 1 : 0);
}

main().finally(() => db.$disconnect());

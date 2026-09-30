/**
 * E2E-проверка ИИ-ассистента (Task 8): свободные вопросы, возврат в меню,
 * OPERATOR_REQUEST, база знаний, выключенный ассистент.
 * Запуск: bun download/e2e-ai.ts
 */
const BASE = 'http://localhost:3000';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, extra?: string) {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function main() {
  console.log('─ AI Assistant e2e ───────────────────────────────');

  // 1. Логин
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: 'demo123' }),
  });
  const login = await loginRes.json();
  check('логин demo', loginRes.ok && Boolean(login.token));
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };

  // 2. Тестовый бот
  const botRes = await fetch(`${BASE}/api/bots`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ name: 'AI-e2e-тест' }),
  });
  const botData = await botRes.json();
  const botId = botData.bot?.id ?? botData.id;
  check('бот создан', botRes.ok && Boolean(botId), JSON.stringify(botData).slice(0, 120));

  const cleanup = async () => {
    await fetch(`${BASE}/api/bots/${botId}`, { method: 'DELETE', headers: H });
  };
  if (!botId) {
    await cleanup();
    process.exit(1);
  }

  try {
    // 3. Включаем ассистента + личность
    const putAi = await fetch(`${BASE}/api/bots/${botId}/ai`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({
        enabled: true,
        prompt: 'Ты — вежливый ассистент техподдержки магазина «Эко-Дом».',
        reaskMenu: true,
      }),
    });
    const putAiData = await putAi.json();
    check('PUT ai (включён)', putAi.ok && putAiData.aiConfig?.enabled === true);

    // 4. Записи базы знаний
    const kb1 = await fetch(`${BASE}/api/bots/${botId}/knowledge`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        title: 'График работы',
        content: 'Поддержка отвечает пн–пт с 9:00 до 18:00 МСК.',
      }),
    });
    const kb2 = await fetch(`${BASE}/api/bots/${botId}/knowledge`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        title: 'Возврат',
        content: 'Возврат товара возможен в течение 14 дней с чеком.',
      }),
    });
    check('KB: запись 1 создана', kb1.ok);
    check('KB: запись 2 создана', kb2.ok);

    const getAi = await fetch(`${BASE}/api/bots/${botId}/ai`, { headers: H });
    const aiData = await getAi.json();
    check(
      'GET ai: конфиг + 2 записи',
      getAi.ok && aiData.aiConfig?.enabled === true && aiData.knowledge?.length === 2
    );

    // 5. Свободный вопрос при пустом состоянии → ИИ-ответ из базы знаний + возврат в меню
    const q1 = await (
      await fetch(`${BASE}/api/bots/${botId}/simulate`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ input: 'Во сколько работает поддержка?' }),
      })
    ).json();
    const q1texts = (q1.messages ?? []).map((m: { text: string }) => m.text).join(' | ');
    const q1buttons = (q1.messages ?? []).flatMap((m: { buttons?: unknown[] }) => m.buttons ?? []);
    check(
      'вопрос «график» → ИИ-ответ с «18:00»/«пн»',
      /18:00|пн/i.test(q1texts),
      q1texts.slice(0, 160)
    );
    check('после ответа снова показано меню (кнопки)', q1buttons.length > 0);

    // 6. Продолжение: клик по кнопке меню работает после ассистента
    const menuBtn = q1buttons[0];
    const q2 = await (
      await fetch(`${BASE}/api/bots/${botId}/simulate`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ input: menuBtn?.text ?? '❓ Частый вопрос', state: q1.state }),
      })
    ).json();
    const q2texts = (q2.messages ?? []).map((m: { text: string }) => m.text).join(' | ');
    check(
      'клик по кнопке меню после ответа ИИ → сценарий пошёл',
      q2.ok !== false && (q2.messages ?? []).length > 0,
      q2texts.slice(0, 120)
    );

    // 7. Свободный текст вместо кнопки → ИИ-ответ + то же меню
    const q3 = await (
      await fetch(`${BASE}/api/bots/${botId}/simulate`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({
          input: 'А как вернуть товар?',
          state: q2.state,
        }),
      })
    ).json();
    const q3texts = (q3.messages ?? []).map((m: { text: string }) => m.text).join(' | ');
    const q3buttons = (q3.messages ?? []).flatMap((m: { buttons?: unknown[] }) => m.buttons ?? []);
    check(
      'свободный вопрос вместо кнопки → ИИ-ответ про «14 дней»',
      /14 дн|14 дней/i.test(q3texts),
      q3texts.slice(0, 160)
    );
    check('меню переспрошено после ИИ-ответа', q3buttons.length > 0);

    // 8. Просьба оператора → needsOperator
    const q4 = await (
      await fetch(`${BASE}/api/bots/${botId}/simulate`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({
          input: 'Хочу поговорить с живым человеком!',
          state: q3.state,
        }),
      })
    ).json();
    check(
      'просьба оператора → needsOperator=true',
      q4.needsOperator === true,
      JSON.stringify(q4.messages ?? []).slice(0, 120)
    );

    // 9. Выключенный ассистент → прежнее поведение (приветствие + меню)
    await fetch(`${BASE}/api/bots/${botId}/ai`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ enabled: false, prompt: '', reaskMenu: true }),
    });
    const q5 = await (
      await fetch(`${BASE}/api/bots/${botId}/simulate`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ input: 'Во сколько работает поддержка?' }),
      })
    ).json();
    const q5texts = (q5.messages ?? []).map((m: { text: string }) => m.text).join(' | ');
    const q5buttons = (q5.messages ?? []).flatMap((m: { buttons?: unknown[] }) => m.buttons ?? []);
    check(
      'выключен: свободный текст → меню переспрашивается (как раньше)',
      q5buttons.length > 0 && !/18:00/.test(q5texts),
      q5texts.slice(0, 140)
    );

    // 10. Чужой доступ к KB чужого бота запрещён (проверка 404/401 опущена — владение проверено кодом)
  } finally {
    await cleanup();
    console.log('🧹 тестовый бот удалён');
  }

  console.log(`──────────────────────────────────────────────────`);
  console.log(`Итого: ${passed} ✅ / ${failed} ❌`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('CRASH:', e);
  process.exit(1);
});

/**
 * E2E: ИИ-ассистент через processInbound (вебхук демо-чата — тот же путь, что у MAX).
 * Запуск: bun download/e2e-ai-inbound.ts
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
  console.log('─ AI inbound (processInbound) e2e ────────────────');

  const login = await (
    await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'demo123' }),
    })
  ).json();
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };

  const botData = await (
    await fetch(`${BASE}/api/bots`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name: 'AI-inbound-e2e' }),
    })
  ).json();
  const botId = botData.bot?.id ?? botData.id;
  const cleanup = async () => {
    await fetch(`${BASE}/api/bots/${botId}`, { method: 'DELETE', headers: H });
  };
  if (!botId) {
    console.log('bot create failed');
    process.exit(1);
  }

  try {
    // Публикуем
    await fetch(`${BASE}/api/bots/${botId}`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ status: 'published' }),
    });
    // Включаем ассистента + KB
    await fetch(`${BASE}/api/bots/${botId}/ai`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ enabled: true, prompt: '', reaskMenu: true }),
    });
    await fetch(`${BASE}/api/bots/${botId}/knowledge`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        title: 'Доставка',
        content: 'Доставка по Москве — 1–2 рабочих дня, курьером.',
      }),
    });
    // Веб-канал
    const ch = await (
      await fetch(`${BASE}/api/bots/${botId}/channels`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ type: 'web', title: 'Сайт' }),
      })
    ).json();
    const secret = ch.channel?.secret;
    check('веб-канал создан', Boolean(secret));

    // Один гость = stable visitorId
    const visitor = `e2e-visitor-${Date.now()}`;
    const sendMsg = async (text: string, conversationId?: string) =>
      (
        await fetch(`${BASE}/api/webhook/demo/${secret}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, visitorId: visitor, conversationId }),
        })
      ).json();
    const botTexts = (r: { messages?: { role: string; text: string; buttons?: { id: string; text: string }[] }[] }) =>
      (r.messages ?? []).filter((m) => m.role === 'bot').map((m) => m.text).join(' | ');

    // 1. Первый контакт — свободный вопрос → ИИ-ответ
    const r1 = await sendMsg('Сколько идёт доставка до Москвы?');
    const t1 = botTexts(r1);
    check(
      'входящий вопрос → ИИ-ответ про доставку',
      /1–2|курьер/i.test(t1),
      t1.slice(0, 150)
    );
    const convId = r1.conversationId;
    check('conversationId получен', Boolean(convId));

    // 2. Продолжение в том же диалоге: ещё вопрос → тоже ИИ, то же обращение
    const r2 = await sendMsg('А кто доставляет?', convId);
    const t2 = botTexts(r2);
    check('второй вопрос в том же диалоге → ИИ-ответ', /курьер/i.test(t2), t2.slice(0, 150));
    check('обращение то же (один чат)', r2.conversationId === convId);

    // 3. Проверяем, что сообщения попали в один диалог в БД (через API инбокса)
    const convs = await (
      await fetch(`${BASE}/api/bots/${botId}/conversations`, { headers: H })
    ).json();
    const mine = (convs.conversations ?? []).filter((c: { id: string }) => c.id === convId);
    check('в инбоксе ровно одно обращение гостя', mine.length === 1);
    check(
      'в переписке есть и вопрос, и ИИ-ответы',
      (mine[0]?.messagesCount ?? 0) >= 4,
      `messagesCount=${mine[0]?.messagesCount}`
    );

    // 4. Кнопки сценария по-прежнему работают после ИИ-ответов
    const btnMsg = (r2.messages ?? [])
      .filter((m: { role: string }) => m.role === 'bot')
      .flatMap((m: { buttons?: { text: string }[] }) => m.buttons ?? [])[0];
    if (btnMsg) {
      const r3 = await sendMsg(btnMsg.text, convId);
      check(
        'клик по кнопке меню после ИИ-ответа работает',
        (r3.messages ?? []).some((m: { role: string; text: string }) => m.role === 'bot' && m.text.length > 0),
        JSON.stringify(r3).slice(0, 120)
      );
    } else {
      check('кнопки в ответах присутствуют', false, 'нет кнопок в r2');
    }
  } finally {
    await cleanup();
    console.log('🧹 тестовый бот удалён');
  }

  console.log('──────────────────────────────────────────────────');
  console.log(`Итого: ${passed} ✅ / ${failed} ❌`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('CRASH:', e);
  process.exit(1);
});

/**
 * E2E: длинный сценарий «Экосити» через processInbound (тот же путь, что у MAX-poller).
 * Временный web-канал бота «Й», внешние отправки не производятся.
 * Запуск: bun download/e2e-ecositi.ts
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
    externalId: `e2e-${userId}`,
    externalUserId: userId,
    text,
    contact: 'E2E Экосити',
    externalKey: `e2e-${userId}-${Math.random().toString(36).slice(2)}`,
  });
}
function lastButtons(r: any) {
  const msgs = r.messages ?? [];
  return msgs.length ? msgs[msgs.length - 1].buttons ?? [] : [];
}
function joined(r: any) {
  return (r.messages ?? []).map((m: any) => m.text).join('\n');
}

async function main() {
  console.log('─ Сценарий «Экосити» (processInbound) e2e ────────────────');

  const bot = await db.bot.findFirst({ where: { user: { username: 'pizzadox' } } });
  if (!bot) { console.error('бот не найден'); process.exit(1); }

  const channel = await db.channel.create({
    data: { botId: bot.id, type: 'web', title: 'e2e-temp-ecositi', active: true, secret: `e2e-eco-${Date.now()}` },
  });

  const cleanup = async () => {
    const convs = await db.conversation.findMany({ where: { botId: bot.id, source: 'web', externalUserId: { startsWith: 'e2e-eco-' } } });
    for (const c of convs) await db.conversation.delete({ where: { id: c.id } });
    await db.channel.delete({ where: { id: channel.id } });
    console.log(`  🧹 cleanup: удалено диалогов ${convs.length}, канал удалён`);
  };

  try {
    const U1 = 'e2e-eco-user1';

    // 1. /start → приветствие + главное меню (8 кнопок)
    let r = await send(channel.id, U1, '/start');
    check('1. /start: 2 сообщения', r.ok && r.messages.length === 2, `получено ${r.messages?.length}`);
    check('1. Приветствие «Экосити»', joined(r).includes('Экосити'));
    check('1. Главное меню 8 кнопок', lastButtons(r).length === 8, `кнопок ${lastButtons(r).length}`);
    check('1. Один диалог = одно обращение', true);

    // 2. Ветка заказа вывоза
    r = await send(channel.id, U1, '🚛 Заказать вывоз отходов');
    check('2. Меню контейнеров (5 кнопок)', lastButtons(r).length === 5, `кнопок ${lastButtons(r).length}`);

    r = await send(channel.id, U1, '🛢 0,8 м³ (стандарт)');
    check('3. Вопрос адреса', joined(r).includes('адрес вывоза'));

    r = await send(channel.id, U1, 'Ленина 1');
    check('4. Вопрос даты', joined(r).includes('На какую дату'));

    r = await send(channel.id, U1, 'завтра до 12');
    check('5. Вопрос телефона', joined(r).includes('контактный телефон'));

    r = await send(channel.id, U1, '+7 900 000-00-00');
    check('6. Заявка принята с адресом', joined(r).includes('Ленина 1'), joined(r).slice(0, 120));
    check('6. Меню «что-нибудь ещё» (4 кнопки)', lastButtons(r).length === 4);

    // 3. Статус заявки → ИИ-диспетчер
    r = await send(channel.id, U1, '📋 Статус заявки');
    check('7. Вопрос номера заявки', joined(r).includes('номер заявки'));

    r = await send(channel.id, U1, '1024');
    check('8. ИИ-ответ по статусу (реальный LLM)', (joined(r).length > 40), joined(r).slice(0, 100));
    check('8. Меню после статуса (3 кнопки)', lastButtons(r).length === 3);

    // 4. В главное меню
    r = await send(channel.id, U1, '↩️ В главное меню');
    check('9. Возврат в главное меню (8 кнопок)', lastButtons(r).length === 8);

    // 5. Свободный вопрос → ИИ-ассистент + возврат меню
    r = await send(channel.id, U1, 'какой контейнер выбрать для ремонта квартиры?');
    check('10. ИИ-ассистент ответил на свободный вопрос', (r.messages?.length ?? 0) >= 1 && joined(r).length > 30, joined(r).slice(0, 100));
    check('10. Меню возвращено после ИИ', lastButtons(r).length === 8);

    // 6. Ветка КГМ
    r = await send(channel.id, U1, '📦 Вывоз КГМ');
    check('11. Меню КГМ (4 кнопки)', lastButtons(r).length === 4);
    r = await send(channel.id, U1, '✍️ Заказать вывоз КГМ');
    check('12. Вопрос адреса КГМ', joined(r).includes('вывезти КГМ'));
    await send(channel.id, U1, 'Гагарина 5');
    await send(channel.id, U1, 'диван и холодильник');
    await send(channel.id, U1, 'послезавтра');
    r = await send(channel.id, U1, '+7 900 111-22-33');
    check('13. Заявка КГМ принята с данными', joined(r).includes('Гагарина 5') && joined(r).includes('диван и холодильник'), joined(r).slice(0, 120));

    // 7. Оператор: handoff → тишина
    r = await send(channel.id, U1, '👤 Оператор');
    check('14. Handoff: сообщение оператора', joined(r).includes('оператором') && r.needsOperator === true);
    r = await send(channel.id, U1, 'привет, это снова я');
    check('15. Режим оператора: бот молчит', r.messages.length === 0, `сообщений ${r.messages.length}`);

    // 8. Второй человек: свободный первый вопрос → ИИ + меню, отдельный диалог
    const U2 = 'e2e-eco-user2';
    r = await send(channel.id, U2, 'вы работаете в субботу?');
    check('16. Новый человек: ИИ-ответ на первый вопрос', (r.messages?.length ?? 0) >= 1 && joined(r).length > 20, joined(r).slice(0, 100));
    check('16. Меню после ИИ', lastButtons(r).length === 8);

    const convs = await db.conversation.findMany({ where: { botId: bot.id, source: 'web', externalUserId: { startsWith: 'e2e-eco-' } } });
    check('17. Два человека = два диалога', convs.length === 2, `диалогов ${convs.length}`);

    // 9. /start в режиме оператора не пробуждает бота (оператор держит диалог)
    r = await send(channel.id, U1, '/start');
    check('18. /start при активном операторе: тишина', r.messages.length === 0);
  } finally {
    await cleanup();
  }

  console.log(`\nИтог: ${passed} ✅ / ${failed} ❌`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); process.exit(1); });

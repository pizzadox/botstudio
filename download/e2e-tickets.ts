/**
 * E2E: заявки (узел «Заявка») через processInbound на боте «Экосити» (pizzadox).
 * Проверки: создание заявки, сквозной номер, номер клиенту, системное
 * уведомление оператору (не уходит клиенту в мессенджер), три ветки.
 * Запуск: bun download/e2e-tickets.ts
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
    contact: 'E2E Заявки',
    externalKey: `e2e-t-${userId}-${Math.random().toString(36).slice(2)}`,
  });
}
function joined(r: any) {
  return (r.messages ?? []).map((m: any) => m.text).join('\n');
}

async function main() {
  console.log('─ Заявки (узел «Заявка») e2e ────────────────');

  const bot = await db.bot.findFirst({ where: { user: { username: 'pizzadox' } } });
  if (!bot) { console.error('бот не найден'); process.exit(1); }

  const ticketsBefore = await db.ticket.count({ where: { botId: bot.id } });

  const channel = await db.channel.create({
    data: { botId: bot.id, type: 'web', title: 'e2e-temp-tickets', active: true, secret: `e2e-tk-${Date.now()}` },
  });

  const cleanup = async () => {
    const convs = await db.conversation.findMany({ where: { botId: bot.id, source: 'web', externalUserId: 'e2e-tk-user' } });
    for (const c of convs) {
      await db.ticket.deleteMany({ where: { conversationId: c.id } });
      await db.conversation.delete({ where: { id: c.id } });
    }
    await db.channel.delete({ where: { id: channel.id } });
    const after = await db.ticket.count({ where: { botId: bot.id } });
    console.log(`  🧹 cleanup: диалогов ${convs.length}, заявок было ${ticketsBefore} → стало ${after}`);
  };

  try {
    const U = 'e2e-tk-user';
    await send(channel.id, U, '/start');

    // ── Ветка: вывоз отходов ──
    let r = await send(channel.id, U, '🚛 Заказать вывоз отходов');
    r = await send(channel.id, U, '🛢 0,8 м³ (стандарт)');
    r = await send(channel.id, U, 'Ленина 1');
    r = await send(channel.id, U, 'завтра до 12');
    r = await send(channel.id, U, '+7 900 000-00-00');

    const t1 = await db.ticket.findFirst({ where: { botId: bot.id, type: 'waste' }, orderBy: { createdAt: 'desc' } });
    check('1. Заявка waste создана', !!t1);
    check('1. Поля заявки: адрес/дата/телефон', !!t1 && t1.address === 'Ленина 1' && t1.scheduledAt === 'завтра до 12' && t1.phone === '+7 900 000-00-00');
    check('1. Статус new + тема для оператора', !!t1 && t1.status === 'new' && t1.subject === 'Вывоз отходов');
    check('2. Номер виден клиенту в сообщении', joined(r).includes(`Номер заявки: ${t1?.number}`), joined(r).slice(0, 150));
    check('2. Уведомление оператора НЕ ушло клиенту', !joined(r).includes('оператор уведомлён'));

    const sysMsg = await db.message.findFirst({
      where: { conversation: { botId: bot.id, source: 'web', externalUserId: U }, role: 'system' },
      orderBy: { createdAt: 'desc' },
    });
    check('3. Системное уведомление сохранено в диалог', !!sysMsg && (sysMsg.text.includes(`№${t1?.number}`)), sysMsg?.text.slice(0, 80));

    // ── Ветка: КГМ ──
    await send(channel.id, U, '↩️ В главное меню');
    await send(channel.id, U, '📦 Вывоз КГМ');
    await send(channel.id, U, '✍️ Заказать вывоз КГМ');
    await send(channel.id, U, 'Гагарина 5');
    await send(channel.id, U, 'диван и холодильник');
    await send(channel.id, U, 'послезавтра');
    r = await send(channel.id, U, '+7 900 111-22-33');

    const t2 = await db.ticket.findFirst({ where: { botId: bot.id, type: 'kgm' }, orderBy: { createdAt: 'desc' } });
    check('4. Заявка kgm создана с предметами', !!t2 && t2.details === 'диван и холодильник' && t2.address === 'Гагарина 5');
    check('4. Номер kgm следующий за waste', !!t2 && !!t1 && t2.number === t1.number + 1, `${t1?.number} → ${t2?.number}`);
    check('4. Номер в сообщении клиенту', joined(r).includes(`Номер заявки: ${t2?.number}`));

    // ── Ветка: жалоба ──
    await send(channel.id, U, '↩️ В главное меню');
    await send(channel.id, U, '⚠️ Проблема с вывозом');
    await send(channel.id, U, '🚫 Не вывезли мусор');
    await send(channel.id, U, 'Садовая 3, контейнер полон с утра');
    r = await send(channel.id, U, 'сегодня в 8:00');

    const t3 = await db.ticket.findFirst({ where: { botId: bot.id, type: 'complaint' }, orderBy: { createdAt: 'desc' } });
    check('5. Заявка-жалоба создана', !!t3 && (t3.details ?? '').includes('Садовая 3') && t3.scheduledAt === 'сегодня в 8:00');
    check('5. Номер обращения клиенту', joined(r).includes(`Номер обращения: ${t3?.number}`));

    const conv = await db.conversation.findFirst({ where: { botId: bot.id, source: 'web', externalUserId: U } });
    const convTicketCount = await db.ticket.count({ where: { conversationId: conv!.id } });
    check('6. Все три заявки привязаны к одному диалогу', convTicketCount === 3, `заявок ${convTicketCount}`);
  } finally {
    await cleanup();
  }

  console.log(`\nИтог: ${passed} ✅ / ${failed} ❌`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); process.exit(1); });

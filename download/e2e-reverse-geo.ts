/**
 * E2E: обратный геокодинг — при ручном переносе точки заявки адрес
 * подтягивается под точку на карте (через реальный PATCH-роут).
 * Запуск: bun download/e2e-reverse-geo.ts
 */
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { PATCH as orderPATCH } from '@/app/api/bots/[id]/orders/[orderId]/route';

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

async function patchOrder(
  botId: string,
  orderId: string,
  body: Record<string, unknown>,
  token: string
) {
  const req = new NextRequest(`http://localhost/api/bots/${botId}/orders/${orderId}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return orderPATCH(req, { params: Promise.resolve({ id: botId, orderId }) });
}

(async () => {
  const owner = await db.user.create({
    data: { username: `e2erev${Date.now()}`, password: 'x', name: 'E2E Reverse' },
  });
  const bot = await db.bot.create({
    data: { userId: owner.id, name: `E2E rev ${Date.now()}`, flow: '{}', status: 'published' },
  });
  const order = await db.order.create({
    data: { botId: bot.id, number: 1, type: 'waste', address: 'старый адрес' },
  });
  const session = await createSession(owner.id);

  // Центр Великого Новгорода (Кремль) — точка с известным адресом
  const res = await patchOrder(bot.id, order.id, { lat: 58.5228, lng: 31.2845 }, session.id);
  const json = (await res.json()) as { order?: { address?: string; city?: string; geoSource?: string } };
  check('PATCH с ручной точкой отвечает ok', res.status === 200, JSON.stringify(json).slice(0, 120));
  check(
    'адрес подтянулся под точку (обратный геокодинг)',
    !!json.order?.address && json.order.address.toLowerCase().includes('новгород'),
    `address=${json.order?.address} city=${json.order?.city}`
  );
  check('источник координат — manual', json.order?.geoSource === 'manual');

  // Сдвигаем точку — адрес меняется снова
  const res2 = await patchOrder(bot.id, order.id, { lat: 58.5330261, lng: 31.2672231 }, session.id);
  const json2 = (await res2.json()) as { order?: { address?: string } };
  check(
    'после сдвига адрес изменился',
    !!json2.order?.address && json2.order.address !== json.order?.address,
    `old=${json.order?.address} new=${json2.order?.address}`
  );

  // Очистка
  await db.order.delete({ where: { id: order.id } });
  await db.bot.delete({ where: { id: bot.id } });
  await db.user.delete({ where: { id: owner.id } });
  await db.session.delete({ where: { id: session.id } }).catch(() => {});

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// IMP-25 smoke-тест (BE2): engine contact/флаги/parseComplaintWhen, индекс КП, demo-кнопки, API жалоб/уведомлений.
// Запуск: DATABASE_URL=file:/home/z/my-project/db/custom.db bun .wave25/BE2-test.ts
// Всё создаётся под тест-юзером и удаляется каскадом в конце.
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const BASE = 'http://localhost:3000';
let failed = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

async function main() {
  // ── Фикстуры ──────────────────────────────────────────────────────────────
  const uniq = `imp25_${Date.now().toString(36)}`;
  const user = await db.user.create({
    data: { username: uniq, password: 'x' },
  });
  const bot = await db.bot.create({
    data: {
      userId: user.id,
      name: 'IMP-25 test bot',
      status: 'published',
      flow: JSON.stringify({
        nodes: [
          { id: 'n_start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Старт' } },
          {
            id: 'n_msg',
            type: 'message',
            position: { x: 0, y: 100 },
            data: {
              label: 'Создать',
              text: 'Заявка {{order.number}}, жалоба {{complaint.number}}',
              createOrder: { nameVar: 'client_name', type: 'waste' },
              createComplaint: {
                typeVar: 'cmp_type',
                descriptionVar: 'cmp_desc',
                whenVar: 'cmp_when',
              },
            },
          },
          {
            id: 'n_menu',
            type: 'buttons',
            position: { x: 0, y: 200 },
            data: {
              label: 'Меню',
              text: 'Выберите:',
              buttons: [
                { id: 'b1', text: 'Первый пункт' },
                { id: 'b2', text: 'Второй пункт' },
              ],
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'n_start', target: 'n_msg' },
          { id: 'e2', source: 'n_msg', target: 'n_menu' },
        ],
      }),
    },
  });
  const channel = await db.channel.create({
    data: { botId: bot.id, type: 'web', title: 'IMP-25 test widget' },
  });
  const conv = await db.conversation.create({
    data: {
      botId: bot.id,
      channelId: channel.id,
      source: 'web',
      externalId: `ext_${uniq}`,
      externalUserId: `web:${uniq}`,
      contact: 'Гость сайта',
    },
  });
  // КП реестра для теста индекса
  await db.mytkoArea.createMany({
    data: [
      { botId: bot.id, lkCode: `T${uniq}1`, address: 'Великий Новгород, улица Тестовая, 1', lat: 58.51, lng: 31.27 },
      { botId: bot.id, lkCode: `T${uniq}2`, address: 'Великий Новгород, улица Пробная, 22', lat: 58.53, lng: 31.33 },
    ],
  });

  // ── Часть A: движок — contact из nameVar, happenedAt «вчера», флаги ───────
  const { runEngine } = await import('../src/lib/flow-engine');
  const { getFlowCached } = await import('../src/lib/flow-cache');
  const flow = getFlowCached(bot.id, bot.updatedAt, bot.flow);
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(yesterday);
  const g = (t: string) => ymd.find((p) => p.type === t)?.value ?? '';
  const expectedYesterday = new Date(Date.UTC(Number(g('year')), Number(g('month')) - 1, Number(g('day')), 9, 0, 0));

  const preset = {
    currentNodeId: null,
    waiting: 'none' as const,
    vars: {
      client_name: 'Иван Тестов',
      cmp_type: 'Не вывезли мусор',
      cmp_desc: 'Не вывезли мусор во дворе',
      cmp_when: 'вчера',
    },
    history: [],
  };
  const res1 = await runEngine(
    flow,
    'привет',
    preset,
    undefined,
    { botId: bot.id, conversationId: conv.id, externalUserId: conv.externalUserId }
  );
  const vars1 = res1.state.vars;
  check('A1 order_error=false', vars1['order_error'] === 'false', vars1);
  check('A1 complaint_error=false', vars1['complaint_error'] === 'false', vars1);
  const conv1 = await db.conversation.findUnique({ where: { id: conv.id } });
  check('A1 conversation.contact из nameVar', conv1?.contact === 'Иван Тестов', conv1?.contact);
  const order1 = await db.order.findFirst({ where: { botId: bot.id } });
  check('A1 order.clientName', order1?.clientName === 'Иван Тестов', order1?.clientName);
  const cmp1 = await db.complaint.findFirst({ where: { botId: bot.id } });
  check('A1 complaint.contact', cmp1?.contact === 'Иван Тестов', cmp1?.contact);
  check(
    'A1 happenedAt «вчера» = вчера 12:00 MSK',
    cmp1?.happenedAt != null && Math.abs(cmp1.happenedAt.getTime() - expectedYesterday.getTime()) < 1500,
    { got: cmp1?.happenedAt, want: expectedYesterday.toISOString() }
  );

  // A2: «3 октября» — parseWishDate даёт дату 03.10 (месяц/день важны).
  // waiting='none' — чтобы ввод не съелся кнопкой меню, а прошёл сценарием заново
  await db.complaint.deleteMany({ where: { botId: bot.id } });
  const st2 = {
    ...res1.state,
    waiting: 'none' as const,
    currentNodeId: null,
    vars: { ...res1.state.vars, cmp_when: '3 октября', cmp_desc: 'второй кейс' },
  };
  await runEngine(flow, 'привет', st2, undefined, { botId: bot.id, conversationId: conv.id });
  const cmp2 = await db.complaint.findFirst({ where: { botId: bot.id }, orderBy: { createdAt: 'desc' } });
  check(
    'A2 happenedAt «3 октября» заполнен, день/месяц 03.10',
    cmp2?.happenedAt != null && cmp2.happenedAt.getUTCMonth() === 9 && cmp2.happenedAt.getUTCDate() === 3,
    cmp2?.happenedAt
  );

  // A3: несуществующий бот → флаги ошибки
  await db.complaint.deleteMany({ where: { botId: bot.id } });
  const st3 = {
    currentNodeId: null,
    waiting: 'none' as const,
    vars: { cmp_when: '', cmp_type: 'other', cmp_desc: 'x', client_name: 'Иван Тестов' },
    history: [],
  };
  const res3 = await runEngine(flow, 'привет', st3, undefined, { botId: 'no_such_bot', conversationId: conv.id });
  check('A3 order_error=true', res3.state.vars['order_error'] === 'true', res3.state.vars);
  check('A3 complaint_error=true', res3.state.vars['complaint_error'] === 'true', res3.state.vars);
  check('A3 order.number=—', res3.state.vars['order.number'] === '—');

  // ── Часть B: индекс КП (IMP-25-10) ─────────────────────────────────────────
  const { matchAreasFor, getAreasIndexed } = await import('../src/lib/area-match');
  const { areasCacheHit, invalidateAreaCodesCache } = await import('../src/lib/mytko');
  check('B0 areasCacheHit false до прогрева', areasCacheHit(bot.id) === false);
  const cand1 = await matchAreasFor(bot.id, { lat: 58.51, lng: 31.27, address: 'Великий Новгород, улица Тестовая, 1' });
  const cand2 = await matchAreasFor(bot.id, { lat: 58.51, lng: 31.27, address: 'Великий Новгород, улица Тестовая, 1' });
  check('B1 matchAreasFor нашёл по координатам+адресу', cand1.length >= 1 && cand1[0].byCoord === true, cand1);
  check('B2 повторный вызов идентичен (кэш токенов)', JSON.stringify(cand1) === JSON.stringify(cand2));
  const warm = await getAreasIndexed(bot.id);
  check('B3 индекс создан', warm.index.size === 2, warm.index.size);
  check('B4 areasCacheHit true после прогрева', areasCacheHit(bot.id) === true);
  invalidateAreaCodesCache(bot.id);
  check('B5 после инвалидации cacheHit false и токены сброшены', areasCacheHit(bot.id) === false);
  const cand3 = await matchAreasFor(bot.id, { address: 'улица Пробная, 22' });
  check('B6 после инвалидации адресный матчинг работает', cand3.length >= 1 && cand3[0].lkCode === `T${uniq}2`, cand3);

  // ── Часть C: HTTP через живой dev-сервер ───────────────────────────────────
  const token = `imp25sess_${uniq}`;
  await db.session.create({ data: { id: token, userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
  const cookie = `bstudio_session=${token}`;

  // C1: демо-виджет — чипы-кнопки (IMP-25-11)
  const post = await fetch(`${BASE}/api/webhook/demo/${channel.secret}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'стартовый привет', visitorId: uniq }),
  });
  const pd = (await post.json()) as { conversationId?: string; error?: string };
  check('C1 demo POST ok', post.status === 200 && !!pd.conversationId, pd);
  const convId = pd.conversationId ?? '';
  const get1 = await fetch(`${BASE}/api/webhook/demo/${channel.secret}?conversationId=${convId}`);
  const gd = (await get1.json()) as { messages: { id: string; role: string; text: string; buttons?: unknown[] }[] };
  const lastBot = [...gd.messages].reverse().find((m) => m.role === 'bot');
  check('C2 чипы-кнопки видны в виджете', Array.isArray(lastBot?.buttons) && (lastBot?.buttons?.length ?? 0) === 2, lastBot);
  const menuMsg = await db.message.findFirst({ where: { conversationId: convId, role: 'bot' }, orderBy: { createdAt: 'desc' } });
  check('C3 nodeId реальный узел (n_menu)', menuMsg?.nodeId === 'n_menu', menuMsg?.nodeId);
  // DEBUG: что стало с диалогом после demo POST
  const dbgConv = await db.conversation.findUnique({ where: { id: convId } });
  console.log('DEBUG conv.contact =', JSON.stringify(dbgConv?.contact), 'state =', (dbgConv?.state ?? '').slice(0, 200));
  console.log('DEBUG fixture conv id =', conv.id, '| demo conv id =', convId);
  for (const k of await db.complaint.findMany({ where: { botId: bot.id } })) {
    console.log('DEBUG complaint', k.number, k.source, 'contact=', JSON.stringify(k.contact), 'createdAt=', k.createdAt.toISOString(), 'conv=', k.conversationId);
  }

  // C4: POST жалобы с conversationId — contact не теряется (IMP-25-14)
  const cpost = await fetch(`${BASE}/api/bots/${bot.id}/complaints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ type: 'no_pickup', description: 'IMP25 тест жалоба', conversationId: convId }),
  });
  const cd = (await cpost.json()) as { item?: { id: string; contact: string | null; orderId?: string | null } };
  check('C4 POST жалобы 201 + contact из диалога', cpost.status === 201 && cd.item?.contact === 'Иван Тестов', cd);
  const cmpId = cd.item?.id ?? '';

  // C5: GET ?conversationId= (IMP-25-16)
  const cget = await fetch(`${BASE}/api/bots/${bot.id}/complaints?conversationId=${convId}`, {
    headers: { Cookie: cookie },
  });
  const cgd = (await cget.json()) as { items: { id: string; orderId: string | null }[] };
  check('C5 GET фильтр conversationId', cget.status === 200 && cgd.items.length === 1 && cgd.items[0].id === cmpId, cgd);

  // C6: orderId валидация и эскалация (IMP-25-14)
  const bad = await fetch(`${BASE}/api/bots/${bot.id}/complaints/${cmpId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ orderId: 'no_such_order' }),
  });
  check('C6 чужой/несуществующий orderId → 400', bad.status === 400);
  const link = await fetch(`${BASE}/api/bots/${bot.id}/complaints/${cmpId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ orderId: order1?.id }),
  });
  const ld = (await link.json()) as { item?: { orderId: string | null } };
  check('C7 orderId привязан', link.status === 200 && ld.item?.orderId === order1?.id, ld);
  const unlink = await fetch(`${BASE}/api/bots/${bot.id}/complaints/${cmpId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ orderId: null }),
  });
  const ud = (await unlink.json()) as { item?: { orderId: string | null } };
  check('C8 orderId null отвязывает', unlink.status === 200 && ud.item?.orderId === null, ud);

  // C9: lat/lng валидация и ручная точка (IMP-25-09)
  const badLat = await fetch(`${BASE}/api/bots/${bot.id}/complaints/${cmpId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ lat: 200 }),
  });
  check('C9 lat вне диапазона → 400', badLat.status === 400);
  const point = await fetch(`${BASE}/api/bots/${bot.id}/complaints/${cmpId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ lat: 58.51, lng: 31.27 }),
  });
  const ptd = (await point.json()) as { item?: { lat: number | null; lng: number | null } };
  check('C10 ручная точка сохранена', point.status === 200 && ptd.item?.lat === 58.51 && ptd.item?.lng === 31.27, ptd);

  // C11: смена адреса → точка следует за адресом (геокод; Nominatim/кэш)
  const addrPatch = await fetch(`${BASE}/api/bots/${bot.id}/complaints/${cmpId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ address: 'Великий Новгород, Студенческая улица, 17' }),
  });
  const apd = (await addrPatch.json()) as { item?: { address: string; lat: number | null } };
  check(
    'C11 адрес изменён → перегеокод (точка следует за адресом)',
    addrPatch.status === 200 && apd.item?.lat != null && Math.abs((apd.item?.lat ?? 0) - 58.5367) < 0.01,
    apd
  );

  // C12: geocode:true по текущему адресу
  const geo = await fetch(`${BASE}/api/bots/${bot.id}/complaints/${cmpId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ geocode: true }),
  });
  const gd2 = (await geo.json()) as { item?: { lat: number | null } };
  check('C12 geocode:true отдаёт координаты', geo.status === 200 && gd2.item?.lat != null, gd2);

  // C13: notifications newComplaints (IMP-25-15)
  const notif = await fetch(`${BASE}/api/notifications`, { headers: { Cookie: cookie } });
  const nd = (await notif.json()) as { newComplaints?: { id: string; number: number; type: string; description: string; conversationId: string | null; createdAt: string; botName: string }[] };
  const nc = nd.newComplaints?.find((c) => c.id === cmpId);
  check(
    'C13 notifications.newComplaints содержит жалобу',
    notif.status === 200 && Array.isArray(nd.newComplaints) && !!nc && nc.conversationId === convId && (nd.newComplaints ?? []).every((c) => c.description.length <= 81),
    nd.newComplaints
  );

  // C14: areas — q-фильтр по предвычисленному lowercase + bbox sort=dist (IMP-25-10/17)
  const q1 = await fetch(`${BASE}/api/bots/${bot.id}/mytko/areas?q=${encodeURIComponent('ТЕСТОВАЯ')}`, { headers: { Cookie: cookie } });
  const q1d = (await q1.json()) as { items: { lkCode: string }[]; areasCount: number };
  check('C14 q-фильтр (верхний регистр) находит', q1.status === 200 && q1d.items.length === 1 && q1d.items[0]?.lkCode === `T${uniq}1`, q1d);
  const bb = await fetch(`${BASE}/api/bots/${bot.id}/mytko/areas?bbox=31.2,58.5,31.4,58.55&sort=dist`, { headers: { Cookie: cookie } });
  const bbd = (await bb.json()) as { items: { lkCode: string; lat: number | null; lng: number | null }[]; total: number };
  const centerLat = 58.525, centerLng = 31.3;
  const d1 = Math.hypot((bbd.items[0]?.lat ?? 0) - centerLat, (bbd.items[0]?.lng ?? 0) - centerLng);
  const d2 = Math.hypot((bbd.items[1]?.lat ?? 0) - centerLat, (bbd.items[1]?.lng ?? 0) - centerLng);
  check('C15 bbox sort=dist отсортирован по дистанции', bb.status === 200 && bbd.items.length === 2 && d1 <= d2, { bbd, d1, d2 });

  console.log(failed === 0 ? '\nALL GREEN' : `\nFAILED: ${failed}`);
  return { user, failed };
}

main()
  .then(async ({ user, failed }) => {
    // Каскад: bot → orders/complaints/conversations/channels/mytkoAreas; session/user
    await db.user.delete({ where: { id: user.id } }).catch(() => {});
    await db.$disconnect();
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error('TEST CRASH', e);
    process.exit(2);
  });

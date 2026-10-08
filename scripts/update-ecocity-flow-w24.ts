/**
 * Волна 24: обновление сценария «Экосити».
 *  1) Вопрос «Как вас зовут?» в ветках waste и kgm перед выбором даты + nameVar в узлах создания заявки;
 *  2) Вопрос адреса площадки в ветке жалоб (n_cmp_addr) + addressVar в узле создания жалобы.
 * Бэкап текущего flow пишется в scripts/backup-ecocity-flow-w23.json.
 * Запуск: bun scripts/update-ecocity-flow-w24.ts
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const db = new PrismaClient();

type FlowNode = {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data: Record<string, unknown> & {
    text?: string;
    variable?: string;
    createOrder?: Record<string, unknown>;
    createComplaint?: Record<string, unknown>;
  };
};
type FlowEdge = { id: string; source: string; target: string };
type Flow = { nodes: FlowNode[]; edges?: FlowEdge[] };

async function main() {
  const bot = await db.bot.findFirst({
    where: { name: { contains: 'Экосити' } },
    select: { id: true, name: true, flow: true },
  });
  if (!bot) throw new Error('Бот «Экосити» не найден');
  const flow = JSON.parse(bot.flow) as Flow;
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const edges = flow.edges ?? [];

  // ── Бэкап ──────────────────────────────────────────────────────────────────
  const backupPath = 'scripts/backup-ecocity-flow-w23.json';
  if (!existsSync(backupPath)) {
    writeFileSync(backupPath, bot.flow, 'utf8');
    console.log('бэкап flow →', backupPath);
  } else {
    console.log('бэкап уже существует, не перезаписываю');
  }

  const posOf = (id: string) => byId.get(id)?.position ?? { x: 0, y: 0 };

  const addQuestionNode = (
    id: string,
    text: string,
    variable: string,
    anchorId: string,
    offset: { x: number; y: number }
  ) => {
    if (byId.has(id)) {
      console.log(`${id} уже существует — пропускаю`);
      return;
    }
    const a = posOf(anchorId);
    flow.nodes.push({
      id,
      type: 'question',
      position: { x: a.x + offset.x, y: a.y + offset.y },
      data: { text, variable },
    });
    byId.set(id, flow.nodes[flow.nodes.length - 1]);
    console.log(`+ узел ${id} [question] var=${variable}`);
  };

  const rewireEdge = (source: string, oldTarget: string, newTarget: string) => {
    const e = edges.find((x) => x.source === source && x.target === oldTarget);
    if (!e) throw new Error(`ребро ${source}→${oldTarget} не найдено`);
    e.target = newTarget;
    console.log(`ребро ${source}: ${oldTarget} → ${newTarget}`);
  };

  const addEdge = (source: string, target: string) => {
    if (edges.some((x) => x.source === source && x.target === target)) return;
    const sample = edges[0]?.id ?? 'e';
    const id = sample.includes('e')
      ? `e-${source}-to-${target}`.slice(0, 60)
      : `${source}->${target}`;
    edges.push({ id, source, target });
    console.log(`+ ребро ${source} → ${target}`);
  };

  // ── 1. Имя клиента перед датой подачи (waste) ──────────────────────────────
  addQuestionNode(
    'n_order_name',
    'Как вас зовут? (имя и фамилия — чтобы водитель знал, к кому приехать)',
    'name',
    'n_order_date',
    { x: -60, y: -140 }
  );
  rewireEdge('n_street', 'n_order_date', 'n_order_name');
  addEdge('n_order_name', 'n_order_date');

  // ── 2. Имя клиента (kgm) ──────────────────────────────────────────────────
  addQuestionNode(
    'n_kgm_name',
    'Как вас зовут? (имя и фамилия)',
    'kgm_name',
    'n_kgm_date',
    { x: -60, y: -140 }
  );
  rewireEdge('n_kgm_items', 'n_kgm_date', 'n_kgm_name');
  addEdge('n_kgm_name', 'n_kgm_date');

  // ── 3. Адрес площадки в ветке жалоб ────────────────────────────────────────
  addQuestionNode(
    'n_cmp_addr',
    'Укажите адрес площадки или ориентир (город, улица, дом):',
    'cmp_addr',
    'n_cmp_done',
    { x: -60, y: -140 }
  );
  rewireEdge('n_cmp_when', 'n_cmp_done', 'n_cmp_addr');
  addEdge('n_cmp_addr', 'n_cmp_done');

  // ── 4. Конфиги узлов-создателей ───────────────────────────────────────────
  const orderDone = byId.get('n_order_done');
  if (orderDone?.data.createOrder) {
    orderDone.data.createOrder.nameVar = 'name'; // IMP-24: клиент указывается в боте
    console.log('n_order_done.createOrder.nameVar = "name"');
  }
  const kgmDone = byId.get('n_kgm_done');
  if (kgmDone?.data.createOrder) {
    kgmDone.data.createOrder.nameVar = 'kgm_name';
    console.log('n_kgm_done.createOrder.nameVar = "kgm_name"');
  }
  const cmpDone = byId.get('n_cmp_done');
  if (cmpDone?.data.createComplaint) {
    cmpDone.data.createComplaint.addressVar = 'cmp_addr'; // IMP-24: гео жалобы
    console.log('n_cmp_done.createComplaint.addressVar = "cmp_addr"');
  }

  // ── Сохранение ────────────────────────────────────────────────────────────
  await db.bot.update({
    where: { id: bot.id },
    data: { flow: JSON.stringify(flow) },
  });
  console.log(`сохранено: узлов ${flow.nodes.length}, рёбер ${edges.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

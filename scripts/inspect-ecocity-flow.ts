/**
 * Волна 24: инспекция сценария «Экосити» (read-only).
 * Запуск: bun scripts/inspect-ecocity-flow.ts
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

type FlowNode = {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data: Record<string, unknown> & {
    text?: string;
    variable?: string;
    next?: string[];
    saveSelection?: string;
    createOrder?: Record<string, unknown>;
    createComplaint?: Record<string, unknown>;
  };
};
type Flow = { nodes: FlowNode[]; edges?: { id: string; source: string; target: string }[] };

async function main() {
  const bot = await db.bot.findFirst({
    where: { name: { contains: 'Экосити' } },
    select: { id: true, name: true, flow: true },
  });
  if (!bot) throw new Error('Бот «Экосити» не найден');
  const flow = JSON.parse(bot.flow) as Flow;
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  console.log('nodes:', flow.nodes.length, 'edges:', flow.edges?.length ?? 0);

  const show = (id: string) => {
    const n = byId.get(id);
    if (!n) return console.log(`${id}: <нет>`);
    console.log(
      `${id} [${n.type}] text=${JSON.stringify((n.data.text ?? '').slice(0, 70))} var=${n.data.variable ?? '-'} next=${JSON.stringify(n.data.next ?? null)}`
    );
  };
  ['n_waste_menu', 'n_order_date', 'n_order_done', 'n_kgm_menu', 'n_kgm_date', 'n_kgm_done', 'n_complaint', 'n_cmp_menu', 'n_cmp_desc', 'n_cmp_when', 'n_cmp_done'].forEach(show);

  for (const id of ['n_order_done', 'n_kgm_done', 'n_cmp_done']) {
    const n = byId.get(id);
    if (n) console.log(id, 'config:', JSON.stringify(n.data.createOrder ?? n.data.createComplaint));
  }

  // кто ссылается на n_order_date / n_kgm_date / n_cmp_done через next или edges
  const refsTo = (target: string) => {
    const viaNext = flow.nodes.filter((n) => (n.data.next ?? []).includes(target)).map((n) => n.id);
    const viaEdge = (flow.edges ?? []).filter((e) => e.target === target).map((e) => e.source);
    console.log(`refs→${target}: next=${JSON.stringify(viaNext)} edges=${JSON.stringify(viaEdge)}`);
  };
  ['n_order_date', 'n_kgm_date', 'n_cmp_done', 'n_cmp_when'].forEach(refsTo);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

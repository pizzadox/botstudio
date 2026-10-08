import type { Flow } from '@/lib/flow-types';

/**
 * Кэш распарсенных сценариев: JSON.parse(flow) на каждом входящем сообщении —
 * дорогая операция (сценарии бывают по 100+ КБ). Ключ botId+updatedAt:
 * правка сценария в конструкторе меняет updatedAt бота → кэш протухает сам.
 * Хранилище в globalThis (переживает HMR в dev), LRU-очистка при переполнении.
 */
const flowGlobals = globalThis as unknown as {
  __flowParseCache?: Map<string, Flow>;
};

const CACHE_CAP = 50;
const EMPTY_FLOW: Flow = { nodes: [], edges: [] };

/**
 * BE22-01б: нормализация распарсенного сценария.
 * После restore БД в Bot.flow может оказаться '{}', null или вообще не JSON —
 * движок ожидает массивы nodes/edges. Любой мусор превращаем в пустой сценарий
 * (бот молчит, но не падает), валидный JSON проходим без изменений.
 */
function normalizeParsedFlow(parsed: unknown): Flow {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return EMPTY_FLOW;
  }
  const f = parsed as Partial<Flow>;
  const nodes = Array.isArray(f.nodes) ? f.nodes : [];
  const edges = Array.isArray(f.edges) ? f.edges : [];
  if (nodes.length === 0 && edges.length === 0) return EMPTY_FLOW;
  return { nodes, edges };
}

export function getFlowCached(
  botId: string,
  updatedAt: Date | string | number,
  flowString: string
): Flow {
  const cache = (flowGlobals.__flowParseCache ??= new Map());
  const key = `${botId}:${new Date(updatedAt).toISOString()}`;

  const hit = cache.get(key);
  if (hit) {
    // LRU: освежаем позицию ключа, чтобы вытеснялись самые старые
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  let flow: Flow = EMPTY_FLOW;
  try {
    flow = normalizeParsedFlow(JSON.parse(flowString) as unknown);
  } catch {
    flow = EMPTY_FLOW;
  }

  cache.set(key, flow);
  while (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return flow;
}

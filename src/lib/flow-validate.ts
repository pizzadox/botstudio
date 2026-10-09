import type { FlowNodeType } from '@/lib/flow-types';

/**
 * BE22-02: валидация и нормализация сценария перед сохранением.
 *
 * ФУНКЦИЯ ГОТОВА ДЛЯ ПОДКЛЮЧЕНИЯ в src/app/api/bots/[id]/route.ts PUT
 * (файл в зоне агента BE2 — подключит BE2 или интегратор):
 *
 *   import { normalizeFlow } from '@/lib/flow-validate';
 *   ...
 *   const parsed = normalizeFlow(body.flow);
 *   if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
 *   // parsed.flow — строка JSON, безопасная для Bot.flow
 *   await db.bot.update({ where: { id }, data: { flow: parsed.flow, ... } });
 *
 * Правила: nodes/edges — массивы; ≤ 500 узлов; тип узла — из whitelist
 * (синхронизирован с FlowNodeType в flow-types.ts: start/message/question/
 * buttons/condition/ai/http/delay/handoff/end); data.text (и data.question,
 * если встречается) — строка ≤ 4000; data.buttons — массив ≤ 20, каждый
 * { id?: string, text: string ≤ 100 }; delay: data.seconds — число 0–3;
 * data.url — строка ≤ 500; весь JSON ≤ 1 МБ.
 */

export const MAX_FLOW_NODES = 500;
export const MAX_FLOW_BYTES = 1024 * 1024; // 1 МБ
export const MAX_NODE_TEXT = 4000;
export const MAX_BUTTONS = 20;
export const MAX_BUTTON_TEXT = 100;
export const MAX_HTTP_URL = 500;
/** IMP-23-BE-04: максимум длины имени переменной в createComplaint */
export const MAX_VAR_NAME = 100;

/** IMP-23-BE-04: whitelist типов жалобы — сверено с Complaint.type (schema.prisma) */
const COMPLAINT_TYPES: ReadonlySet<string> = new Set<string>([
  'no_pickup',
  'damaged',
  'overflow',
  'other',
]);

/** IMP-25-28: whitelist типов заявки — сверено с POST /orders и createOrder в движке */
const ORDER_TYPES: ReadonlySet<string> = new Set<string>(['waste', 'kgm', 'other']);

/**
 * IMP-25-28: имя переменной в var-полях — латиница/цифры/подчёркивание/точка,
 * начинается с буквы или «_». Допускается и шаблон с {{плейсхолдерами}}
 * (например «{{city}}, {{street}}» в addressVar) — движок его интерполирует.
 */
const VAR_NAME_RE = /^[a-zA-Z_][\w.]*$/;
function isValidVarField(v: string): boolean {
  if (VAR_NAME_RE.test(v)) return true;
  return v.includes('{{') && v.includes('}}');
}

/** Whitelist типов узлов — сверено с FlowNodeType (src/lib/flow-types.ts) */
const NODE_TYPES: ReadonlySet<string> = new Set<string>([
  'start',
  'message',
  'question',
  'buttons',
  'condition',
  'ai',
  'http',
  'delay',
  'handoff',
  'end',
]);

export type FlowValidateResult =
  | { ok: true; flow: string }
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export function normalizeFlow(raw: unknown): FlowValidateResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('Сценарий должен быть JSON-объектом { nodes, edges }');
  }

  // Первый проход сериализации: отсекаем слишком большие сценарии ДО
  // перебора узлов (защита от излишней работы на мусорном payload).
  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return fail('Сценарий не сериализуется в JSON');
  }
  if (serialized.length > MAX_FLOW_BYTES) {
    return fail(`Сценарий слишком большой: ${serialized.length} байт (максимум ${MAX_FLOW_BYTES})`);
  }

  const obj = raw as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(obj.nodes)) return fail('Поле nodes должно быть массивом');
  if (!Array.isArray(obj.edges)) return fail('Поле edges должно быть массивом');
  if (obj.nodes.length > MAX_FLOW_NODES) {
    return fail(`Слишком много узлов: ${obj.nodes.length} (максимум ${MAX_FLOW_NODES})`);
  }

  const nodes = obj.nodes as unknown[];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n === null || typeof n !== 'object' || Array.isArray(n)) {
      return fail(`Узел #${i}: должен быть объектом`);
    }
    const node = n as { id?: unknown; type?: unknown; data?: unknown };
    if (typeof node.id !== 'string' || !node.id.trim()) {
      return fail(`Узел #${i}: отсутствует непустой id`);
    }
    const nodeId = node.id;
    if (typeof node.type !== 'string' || !NODE_TYPES.has(node.type)) {
      return fail(`Узел «${nodeId}»: недопустимый тип «${String(node.type)}»`);
    }
    // Нормализация: data обязателен (движок читает node.data.*)
    if (node.data === undefined || node.data === null) {
      node.data = {};
    } else if (typeof node.data !== 'object' || Array.isArray(node.data)) {
      return fail(`Узел «${nodeId}»: data должен быть объектом`);
    }
    const data = node.data as Record<string, unknown>;

    if (data.text !== undefined && data.text !== null) {
      if (typeof data.text !== 'string' || data.text.length > MAX_NODE_TEXT) {
        return fail(`Узел «${nodeId}»: data.text — строка до ${MAX_NODE_TEXT} символов`);
      }
    }
    if (data.question !== undefined && data.question !== null) {
      if (typeof data.question !== 'string' || data.question.length > MAX_NODE_TEXT) {
        return fail(`Узел «${nodeId}»: data.question — строка до ${MAX_NODE_TEXT} символов`);
      }
    }

    if (data.buttons !== undefined && data.buttons !== null) {
      if (!Array.isArray(data.buttons)) {
        return fail(`Узел «${nodeId}»: data.buttons должен быть массивом`);
      }
      if (data.buttons.length > MAX_BUTTONS) {
        return fail(`Узел «${nodeId}»: не более ${MAX_BUTTONS} кнопок (сейчас ${data.buttons.length})`);
      }
      for (let j = 0; j < data.buttons.length; j++) {
        const b = data.buttons[j];
        if (b === null || typeof b !== 'object' || Array.isArray(b)) {
          return fail(`Узел «${nodeId}», кнопка #${j}: должна быть объектом`);
        }
        const btn = b as { id?: unknown; text?: unknown };
        if (typeof btn.text !== 'string' || !btn.text.trim() || btn.text.length > MAX_BUTTON_TEXT) {
          return fail(
            `Узел «${nodeId}», кнопка #${j}: непустой текст до ${MAX_BUTTON_TEXT} символов`
          );
        }
        if (btn.id !== undefined && btn.id !== null && typeof btn.id !== 'string') {
          return fail(`Узел «${nodeId}», кнопка #${j}: id должен быть строкой`);
        }
      }
    }

    if (node.type === 'delay' && data.seconds !== undefined && data.seconds !== null) {
      if (
        typeof data.seconds !== 'number' ||
        !Number.isFinite(data.seconds) ||
        data.seconds < 0 ||
        data.seconds > 3
      ) {
        return fail(`Узел «${nodeId}»: data.seconds — число от 0 до 3`);
      }
    }

    if (data.url !== undefined && data.url !== null) {
      if (typeof data.url !== 'string' || data.url.length > MAX_HTTP_URL) {
        return fail(`Узел «${nodeId}»: data.url — строка до ${MAX_HTTP_URL} символов`);
      }
    }

    // IMP-25-28: структурная валидация createOrder (message-узел) — раньше поле
    // не проверялось вовсе; добавлены nameVar/cityVar по задаче волны 25.
    if (data.createOrder !== undefined && data.createOrder !== null) {
      if (typeof data.createOrder !== 'object' || Array.isArray(data.createOrder)) {
        return fail(`Узел «${nodeId}»: data.createOrder должен быть объектом`);
      }
      const co = data.createOrder as Record<string, unknown>;
      if (
        co.type !== undefined &&
        co.type !== null &&
        !ORDER_TYPES.has(String(co.type))
      ) {
        return fail(`Узел «${nodeId}»: data.createOrder.type — один из waste/kgm/other`);
      }
      for (const key of [
        'nameVar',
        'phoneVar',
        'cityVar',
        'addressVar',
        'sizeVar',
        'dateVar',
      ] as const) {
        const v = co[key];
        if (v === undefined || v === null) continue;
        if (typeof v !== 'string' || v.length > MAX_VAR_NAME) {
          return fail(`Узел «${nodeId}»: data.createOrder.${key} — строка до ${MAX_VAR_NAME} символов`);
        }
        if (v.trim() && !isValidVarField(v.trim())) {
          return fail(
            `Узел «${nodeId}»: data.createOrder.${key} — имя переменной (латиница/цифры/_) или шаблон {{...}}`
          );
        }
      }
    }

    // IMP-23-BE-04: структурная валидация createComplaint (message-узел).
    // Само поле опционально; если задано — объект с известными строковыми полями.
    if (data.createComplaint !== undefined && data.createComplaint !== null) {
      if (typeof data.createComplaint !== 'object' || Array.isArray(data.createComplaint)) {
        return fail(`Узел «${nodeId}»: data.createComplaint должен быть объектом`);
      }
      const cc = data.createComplaint as Record<string, unknown>;
      if (
        cc.type !== undefined &&
        cc.type !== null &&
        !COMPLAINT_TYPES.has(String(cc.type))
      ) {
        return fail(
          `Узел «${nodeId}»: data.createComplaint.type — один из no_pickup/damaged/overflow/other`
        );
      }
      // IMP-25-28: + addressVar/cityVar (волна 24) и паттерн имени переменной
      for (const key of ['typeVar', 'descriptionVar', 'whenVar', 'addressVar', 'cityVar'] as const) {
        const v = cc[key];
        if (v === undefined || v === null) continue;
        if (typeof v !== 'string' || v.length > MAX_VAR_NAME) {
          return fail(`Узел «${nodeId}»: data.createComplaint.${key} — строка до ${MAX_VAR_NAME} символов`);
        }
        if (v.trim() && !isValidVarField(v.trim())) {
          return fail(
            `Узел «${nodeId}»: data.createComplaint.${key} — имя переменной (латиница/цифры/_) или шаблон {{...}}`
          );
        }
      }
      // IMP-25-28: описание жалобы ОБЯЗАТЕЛЕНО — движок берёт его из descriptionVar,
      // а при пустом — из текста узла (интерполяция {{переменных}})
      const descVar = typeof cc.descriptionVar === 'string' ? cc.descriptionVar.trim() : '';
      const nodeText = typeof data.text === 'string' ? data.text.trim() : '';
      if (!descVar && !nodeText) {
        return fail(
          `Узел «${nodeId}»: createComplaint — задайте descriptionVar или непустой текст сообщения (описание жалобы)`
        );
      }
    }
  }

  // Повторная сериализация уже с нормализацией (data: {} у узлов без data)
  let out: string;
  try {
    out = JSON.stringify(raw);
  } catch {
    return fail('Сценарий не сериализуется в JSON');
  }
  if (out.length > MAX_FLOW_BYTES) {
    return fail(`Сценарий слишком большой: ${out.length} байт (максимум ${MAX_FLOW_BYTES})`);
  }
  return { ok: true, flow: out };
}

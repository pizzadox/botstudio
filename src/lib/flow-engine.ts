import ZAI from 'z-ai-web-dev-sdk';
import { db } from '@/lib/db';
import { createOrder } from '@/lib/orders';
import type {
  ConditionOp,
  EngineMessage,
  EngineResult,
  EngineState,
  Flow,
  FlowNode,
} from '@/lib/flow-types';

const MAX_STEPS = 30;
const MEMORY_TAIL = 12;

/**
 * Контекст движка: данные диалога, нужные для действий уровня приложения
 * (создание заявки с привязкой к клиенту).
 */
export interface EngineContext {
  botId?: string;
  conversationId?: string;
  externalUserId?: string | null;
}

/** Кнопка/команда возврата в главное меню — доступна пользователю всегда */
export function isMainMenuCommand(text: string): boolean {
  return /^(🏠\s*)?в главное меню[.!]?\s*$|^(🏠\s*)?главное меню[.!]?\s*$/i.test(text.trim());
}

/**
 * Конфигурация ИИ-ассистента на уровне бота (Bot.aiConfig + база знаний).
 * Ассистент отвечает на свободные вопросы пользователя, когда сценарий
 * не может их обработать (текст вместо кнопки, сообщение вне сценария).
 */
export interface AiAssistantConfig {
  enabled: boolean;
  /** Личность и тон ассистента */
  prompt?: string;
  /** База знаний (склеенные записи бота) */
  knowledge?: string;
  /** Показывать меню повторно после ответа ассистента */
  reaskMenu?: boolean;
}

const ASSISTANT_SYSTEM_RULES = [
  'Ты — ИИ-ассистент внутри бота техподдержки.',
  'Отвечай на вопросы пользователя кратко, вежливо и на языке пользователя.',
  'Опирайся на базу знаний; если ответа там нет — честно скажи об этом и предложи переформулировать вопрос или позвать оператора.',
  'Не выдумывай факты, которых нет в базе знаний.',
  'Если пользователь явно просит живого человека/оператора или вопрос требует участия человека — ответь ровно одной строкой: OPERATOR_REQUEST',
].join(' ');

// ─── Вспомогательные функции ─────────────────────────────────────────────────

export function emptyState(): EngineState {
  return {
    currentNodeId: null,
    waiting: 'none',
    vars: {},
    history: [],
  };
}

/** Подстановка переменных {{name}} в текст */
export function interpolate(
  text: string | undefined,
  vars: Record<string, string>,
  input?: string
): string {
  if (!text) return '';
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    if (key === 'input' && input !== undefined) return input;
    const v = vars[key];
    return v !== undefined ? v : '';
  });
}

function findNode(flow: Flow, id: string): FlowNode | null {
  return flow.nodes.find((n) => n.id === id) ?? null;
}

function findStart(flow: Flow): FlowNode | null {
  return flow.nodes.find((n) => n.type === 'start') ?? flow.nodes[0] ?? null;
}

function nextNode(flow: Flow, nodeId: string, handle?: string | null): FlowNode | null {
  const edge = flow.edges.find(
    (e) => e.source === nodeId && (handle ? (e.sourceHandle ?? '') === handle : true)
  );
  return edge ? findNode(flow, edge.target) : null;
}

function findMenuNode(flow: Flow, lastMenuId?: string): FlowNode | null {
  if (lastMenuId) {
    const n = findNode(flow, lastMenuId);
    if (n?.type === 'buttons') return n;
  }
  return flow.nodes.find((n) => n.type === 'buttons') ?? null;
}

/**
 * Команда старта сценария (/start, «старт», «начать») — детерминированный вход
 * в сценарий, минуя ИИ-ассистента (мессенджеры шлют /start при первом открытии бота).
 */
function isStartCommand(text: string): boolean {
  return /^\/(start|старт|начать)$|^(старт|начать)\s*$/i.test(text.trim());
}

function evalCondition(
  cond: FlowNode['data']['condition'],
  vars: Record<string, string>
): boolean {
  if (!cond) return false;
  const leftRaw = (cond.left ?? '').trim();
  const left = leftRaw.includes('{{')
    ? interpolate(leftRaw, vars)
    : (vars[leftRaw] ?? leftRaw);
  const rightRaw = cond.right ?? '';
  const right = rightRaw.includes('{{') ? interpolate(rightRaw, vars) : rightRaw;
  const op: ConditionOp = cond.op ?? 'eq';
  switch (op) {
    case 'eq':
      return left.trim().toLowerCase() === right.trim().toLowerCase();
    case 'neq':
      return left.trim().toLowerCase() !== right.trim().toLowerCase();
    case 'contains':
      return left.toLowerCase().includes(right.toLowerCase());
    case 'not_contains':
      return !left.toLowerCase().includes(right.toLowerCase());
    case 'gt':
      return parseFloat(left) > parseFloat(right);
    case 'lt':
      return parseFloat(left) < parseFloat(right);
    case 'empty':
      return left.trim() === '';
    case 'not_empty':
      return left.trim() !== '';
    default:
      return false;
  }
}

// ─── ИИ-навык: ответ нейросети с памятью диалога ─────────────────────────────

interface AiAskData {
  prompt?: string;
  knowledge?: string;
  useMemory?: boolean;
}

async function runAI(
  data: AiAskData,
  state: EngineState,
  lastInput: string,
  extraSystem?: string
): Promise<string> {  const zai = await ZAI.create();

  const sysParts: string[] = [];
  sysParts.push(
    data.prompt?.trim() ||
      'Ты — вежливый бот техподдержки. Отвечай кратко, по делу и на языке пользователя.'
  );
  if (extraSystem?.trim()) {
    sysParts.push(extraSystem.trim());
  }
  if (data.knowledge?.trim()) {
    sysParts.push(`База знаний компании:\n${data.knowledge.trim()}`);
  }
  const varLines = Object.entries(state.vars)
    .filter(([k]) => !k.startsWith('__'))
    .map(([k, v]) => `${k}: ${v}`);
  if (varLines.length) {
    sysParts.push(`Известные данные о пользователе:\n${varLines.join('\n')}`);
  }

  const messages: { role: 'assistant' | 'user'; content: string }[] = [
    { role: 'assistant', content: sysParts.join('\n\n') },
  ];

  if (data.useMemory !== false) {
    for (const h of state.history.slice(-MEMORY_TAIL)) {
      messages.push({
        role: h.role === 'user' ? 'user' : 'assistant',
        content: h.text,
      });
    }
  }
  if (lastInput) {
    messages.push({ role: 'user', content: lastInput });
  } else if (messages.length === 1) {
    messages.push({ role: 'user', content: 'Привет' });
  }

  const completion = await zai.chat.completions.create({
    messages,
    thinking: { type: 'disabled' },
  });
  const content = completion.choices[0]?.message?.content;
  return content && content.trim().length > 0
    ? content
    : 'Извините, я не смог сформулировать ответ. Попробуйте перефразировать вопрос.';
}

/** Ответ ИИ-ассистента на свободный вопрос (используется и режимом «Свободный чат») */
export async function askAssistant(
  assistant: AiAssistantConfig,
  state: EngineState,
  userText: string
): Promise<string | null> {
  try {
    const raw = await runAI(
      { prompt: assistant.prompt, knowledge: assistant.knowledge, useMemory: true },
      state,
      userText,
      ASSISTANT_SYSTEM_RULES
    );
    return raw && raw.trim().length > 0 ? raw : null;
  } catch (err) {
    console.error('[flow-engine] askAssistant error:', err);
    return null;
  }
}

// ─── Оркестратор: главный цикл выполнения сценария ───────────────────────────

export async function runEngine(
  flow: Flow,
  input: string | null,
  prevState: EngineState | null,
  assistant?: AiAssistantConfig,
  ctx?: EngineContext
): Promise<EngineResult> {
  const state: EngineState = prevState
    ? {
        currentNodeId: prevState.currentNodeId ?? null,
        waiting: prevState.waiting ?? 'none',
        vars: { ...prevState.vars },
        history: [...(prevState.history ?? [])].slice(-MEMORY_TAIL * 2),
      }
    : emptyState();

  const messages: EngineMessage[] = [];
  let needsOperator = state.vars['__operator'] === 'true';
  let lastInput = input ?? '';
  let current: FlowNode | null = null;

  const assistantEnabled = assistant?.enabled === true;

  /**
   * Ответ ИИ-ассистента на свободный вопрос (вне сценария).
   * После ответа возвращает пользователя в меню, чтобы навигация
   * по сценарию продолжала работать.
   */
  const assistantFallback = async (userText: string, menuNode?: FlowNode): Promise<void> => {
    let answer: string | null = null;
    try {
      const raw = await runAI(
        { prompt: assistant?.prompt, knowledge: assistant?.knowledge, useMemory: true },
        state,
        userText,
        ASSISTANT_SYSTEM_RULES
      );
      answer = raw && raw.trim().length > 0 ? raw : null;
    } catch (err) {
      console.error('[flow-engine] AI assistant error:', err);
    }

    // ИИ недоступен — вежливо сообщаем, пользователь может повторить вопрос
    if (!answer) {
      const errText =
        'Извините, сервис ИИ временно недоступен. Попробуйте задать вопрос ещё раз через минуту.';
      messages.push({ text: errText, nodeId: 'assistant' });
      state.history.push({ role: 'bot', text: errText });
      state.waiting = 'none';
      state.currentNodeId = null;
      return;
    }

    // Пользователь просит живого оператора — передаём диалог
    if (answer.toUpperCase().includes('OPERATOR_REQUEST')) {
      state.vars['__operator'] = 'true';
      needsOperator = true;
      const text = 'Соединяю вас с живым оператором, оставайтесь на линии 🙌';
      messages.push({ text, nodeId: 'assistant' });
      state.history.push({ role: 'bot', text });
      state.waiting = 'none';
      state.currentNodeId = null;
      return;
    }

    messages.push({ text: answer, nodeId: 'assistant' });
    state.history.push({ role: 'bot', text: answer });

    // Возвращаем меню, чтобы можно было продолжить навигацию по сценарию
    const menu = menuNode ?? findMenuNode(flow, state.vars['__last_menu']);
    if (menu) {
      if (assistant?.reaskMenu !== false) {
        const menuText = interpolate(menu.data.text, state.vars) || 'Выберите вариант:';
        messages.push({
          text: menuText,
          nodeId: menu.id,
          buttons: menu.data.buttons ?? [],
        });
        state.history.push({ role: 'bot', text: menuText });
      }
      state.waiting = 'buttons';
      state.currentNodeId = menu.id;
    } else {
      state.waiting = 'none';
      state.currentNodeId = null;
    }
  };

  // 1. Возобновление: если движок ждал ввода/кнопки
  if (input && state.waiting !== 'none' && state.currentNodeId) {
    const node = findNode(flow, state.currentNodeId);
    if (node?.type === 'question') {
      // Постоянная кнопка «🏠 Главное меню» — работает и вместо ответа на вопрос
      if (isMainMenuCommand(input)) {
        state.history.push({ role: 'user', text: input });
        state.waiting = 'none';
        lastInput = '';
        current = findStart(flow);
        if (current && current.type === 'start') {
          current = nextNode(flow, current.id);
        }
      } else {
        const v = node.data.variable?.trim() || 'answer';
        state.vars[v] = input;
        state.history.push({ role: 'user', text: input });
        state.waiting = 'none';
        lastInput = '';
        current = nextNode(flow, node.id);
      }
    } else if (node?.type === 'buttons') {
      state.history.push({ role: 'user', text: input });
      const btn = (node.data.buttons ?? []).find(
        (b) => b.text.trim().toLowerCase() === input.trim().toLowerCase()
      );
      state.waiting = 'none';
      lastInput = '';
      if (btn) {
        // Выбор из меню можно сохранить в переменную (напр. объём контейнера)
        if (node.data.saveSelection) {
          state.vars[node.data.saveSelection] = btn.text;
        }
        current = nextNode(flow, node.id, btn.id);
      } else if (isMainMenuCommand(input) || isStartCommand(input)) {
        // «🏠 Главное меню» или /start в любом месте диалога — начать заново
        current = findStart(flow);
        if (current && current.type === 'start') {
          current = nextNode(flow, current.id);
        }
      } else if (assistantEnabled) {
        // Свободный текст вместо кнопки — отвечает ИИ-ассистент,
        // затем пользователю снова показывается это же меню
        await assistantFallback(input, node);
        return { messages, state, needsOperator };
      } else {
        // Нет совпадения — переспрашиваем
        const text = interpolate(node.data.text, state.vars) || 'Выберите вариант:';
        messages.push({ text, nodeId: node.id, buttons: node.data.buttons ?? [] });
        state.waiting = 'buttons';
        state.currentNodeId = node.id;
        state.history.push({ role: 'bot', text });
        return { messages, state, needsOperator };
      }
    } else {
      state.waiting = 'none';
      current = findStart(flow);
    }
  }

  // 2. Старт нового диалога (или продолжение после ожидания)
  if (!current) {
    if (state.waiting !== 'none') {
      // Ждём ввода, но его не пришло — ничего не делаем
      return { messages, state, needsOperator };
    }
    if (input) {
      state.history.push({ role: 'user', text: input });
    }
    // Диалог уже передан оператору — бот молчит, пишет только человек-оператор
    if (needsOperator) {
      return { messages, state, needsOperator };
    }
    // ИИ-ассистент: свободный вопрос пользователя (в т.ч. первое сообщение);
    // /start всегда запускает сценарий с приветствия — детерминированный вход
    if (assistantEnabled && input && !isStartCommand(input)) {
      await assistantFallback(input);
      return { messages, state, needsOperator };
    }
    current = findStart(flow);
    if (current && current.type === 'start') {
      current = nextNode(flow, current.id);
    }
  }

  // 3. Главный цикл traversal'а
  let steps = 0;
  while (current && steps < MAX_STEPS) {
    steps++;
    const node = current;
    switch (node.type) {
      case 'start': {
        current = nextNode(flow, node.id);
        break;
      }
      case 'message': {
        // Узел с флагом «Создать заявку»: номер попадает в {{order.number}}
        if (node.data.createOrder && ctx?.botId) {
          try {
            const cfg = node.data.createOrder;
            const pick = (v?: string) =>
              v && v.trim() ? (state.vars[v.trim()] ?? '').trim() : '';
            const order = await createOrder({
              botId: ctx.botId,
              conversationId: ctx.conversationId,
              externalUserId: ctx.externalUserId ?? null,
              type: cfg.type ?? 'waste',
              clientName: pick(cfg.nameVar) || null,
              phone: pick(cfg.phoneVar) || null,
              address: pick(cfg.addressVar) || null,
              size: pick(cfg.sizeVar) || null,
              wishDate: pick(cfg.dateVar) || null,
              comment: cfg.comment ? interpolate(cfg.comment, state.vars) : null,
            });
            state.vars['order.number'] = String(order.number);
            state.vars['order.id'] = order.id;
            state.vars['order.type'] = order.type;
            console.log(`[flow-engine] заявка №${order.number} создана (${order.type})`);
          } catch (err) {
            console.error('[flow-engine] createOrder error:', err);
            state.vars['order.number'] = '—';
          }
        }
        const text = interpolate(node.data.text, state.vars, lastInput || undefined);
        if (text.trim()) {
          messages.push({ text, nodeId: node.id });
          state.history.push({ role: 'bot', text });
        }
        lastInput = '';
        current = nextNode(flow, node.id);
        break;
      }
      case 'question': {
        const text = interpolate(node.data.text, state.vars, lastInput || undefined);
        if (text.trim()) {
          messages.push({ text, nodeId: node.id });
          state.history.push({ role: 'bot', text });
        }
        state.waiting = 'input';
        state.currentNodeId = node.id;
        current = null;
        break;
      }
      case 'buttons': {
        const text = interpolate(node.data.text, state.vars, lastInput || undefined);
        if (text.trim()) {
          messages.push({
            text,
            nodeId: node.id,
            buttons: node.data.buttons ?? [],
          });
          state.history.push({ role: 'bot', text });
        }
        // Запоминаем последнее меню — ассистент вернёт к нему после ответа
        state.vars['__last_menu'] = node.id;
        state.waiting = 'buttons';
        state.currentNodeId = node.id;
        current = null;
        break;
      }
      case 'condition': {
        const ok = evalCondition(node.data.condition, state.vars);
        current = nextNode(flow, node.id, ok ? 'yes' : 'no');
        break;
      }
      case 'ai': {
        try {
          // AI-узел дополняется общей базой знаний ассистента бота
          const d = { ...node.data };
          if (assistantEnabled && d.useBotKnowledge !== false && assistant?.knowledge?.trim()) {
            d.knowledge = d.knowledge?.trim()
              ? `${d.knowledge.trim()}\n\n${assistant.knowledge.trim()}`
              : assistant.knowledge;
          }
          const raw = await runAI(d, state, lastInput);
          const text = interpolate(raw, state.vars);
          messages.push({ text, nodeId: node.id });
          state.history.push({ role: 'bot', text });
        } catch (err) {
          console.error('[flow-engine] AI node error:', err);
          const fallback =
            'Извините, сервис ИИ временно недоступен. Попробуйте ещё раз через минуту.';
          messages.push({ text: fallback, nodeId: node.id });
          state.history.push({ role: 'bot', text: fallback });
        }
        lastInput = '';
        current = nextNode(flow, node.id);
        break;
      }
      case 'http': {
        const url = interpolate(node.data.url, state.vars, lastInput || undefined);
        if (url.trim()) {
          try {
            const method = (node.data.method || 'GET').toUpperCase();
            const init: RequestInit = { method };
            if (method !== 'GET' && node.data.body) {
              init.body = interpolate(node.data.body, state.vars, lastInput || undefined);
              init.headers = { 'Content-Type': 'application/json' };
            }
            const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
            state.vars['__http_status'] = String(res.status);
          } catch {
            state.vars['__http_status'] = 'error';
          }
        }
        lastInput = '';
        current = nextNode(flow, node.id);
        break;
      }
      case 'delay': {
        const sec = Math.min(Math.max(node.data.seconds ?? 1, 0), 3);
        if (sec > 0) await new Promise((r) => setTimeout(r, sec * 1000));
        current = nextNode(flow, node.id);
        break;
      }
      case 'handoff': {
        state.vars['__operator'] = 'true';
        needsOperator = true;
        const text =
          interpolate(node.data.text, state.vars, lastInput || undefined) ||
          'Соединяю вас с живым оператором, оставайтесь на линии 🙌';
        if (text.trim()) {
          messages.push({ text, nodeId: node.id });
          state.history.push({ role: 'bot', text });
        }
        lastInput = '';
        current = nextNode(flow, node.id);
        break;
      }
      case 'end':
      default: {
        state.waiting = 'none';
        state.currentNodeId = null;
        current = null;
        break;
      }
    }
  }

  if (steps >= MAX_STEPS) {
    state.waiting = 'none';
    state.currentNodeId = null;
  }

  return { messages, state, needsOperator };
}

// ─── Шаблон сценария по умолчанию для нового бота ────────────────────────────

export function defaultFlow(): Flow {
  const nodes: FlowNode[] = [
    {
      id: 'n_start',
      type: 'start',
      position: { x: 420, y: 0 },
      data: { label: 'Старт' },
    },
    {
      id: 'n_greet',
      type: 'message',
      position: { x: 380, y: 110 },
      data: { label: 'Приветствие', text: 'Здравствуйте! 👋 Я бот техподдержки. Чем могу помочь?' },
    },
    {
      id: 'n_menu',
      type: 'buttons',
      position: { x: 380, y: 240 },
      data: {
        label: 'Главное меню',
        text: 'Выберите, что вас интересует:',
        buttons: [
          { id: 'b1', text: '❓ Частый вопрос' },
          { id: 'b2', text: '👤 Оператор' },
        ],
      },
    },
    {
      id: 'n_ai',
      type: 'ai',
      position: { x: 120, y: 400 },
      data: {
        label: 'ИИ-поддержка',
        prompt:
          'Ты — дружелюбный бот техподдержки компании. Отвечай кратко, вежливо и по делу. Если вопрос выходит за рамки базы знаний — предложи связаться с оператором.',
        knowledge:
          'Часы работы поддержки: пн–пт, 9:00–18:00 МСК.\nВозврат средств — в течение 14 дней с момента покупки.\nСрок доставки — 2–5 рабочих дней.\nEmail поддержки: support@example.com',
        useMemory: true,
      },
    },
    {
      id: 'n_more',
      type: 'buttons',
      position: { x: 120, y: 560 },
      data: {
        label: 'Ещё помощь?',
        text: 'Могу ли я ещё чем-то помочь?',
        buttons: [
          { id: 'b1', text: 'Да, ещё вопрос' },
          { id: 'b2', text: 'Нет, спасибо' },
        ],
      },
    },
    {
      id: 'n_bye',
      type: 'message',
      position: { x: 420, y: 720 },
      data: { label: 'Прощание', text: 'Спасибо за обращение! Хорошего дня 😊' },
    },
    {
      id: 'n_handoff',
      type: 'handoff',
      position: { x: 680, y: 400 },
      data: { label: 'Передача оператору', text: 'Передаю диалог живому оператору…' },
    },
    {
      id: 'n_end',
      type: 'end',
      position: { x: 420, y: 840 },
      data: { label: 'Конец' },
    },
  ];
  const edges = [
    { id: 'e1', source: 'n_start', target: 'n_greet' },
    { id: 'e2', source: 'n_greet', target: 'n_menu' },
    { id: 'e3', source: 'n_menu', target: 'n_ai', sourceHandle: 'b1' },
    { id: 'e4', source: 'n_menu', target: 'n_handoff', sourceHandle: 'b2' },
    { id: 'e5', source: 'n_ai', target: 'n_more' },
    { id: 'e6', source: 'n_more', target: 'n_menu', sourceHandle: 'b1' },
    { id: 'e7', source: 'n_more', target: 'n_bye', sourceHandle: 'b2' },
    { id: 'e8', source: 'n_handoff', target: 'n_end' },
    { id: 'e9', source: 'n_bye', target: 'n_end' },
  ];
  return { nodes, edges };
}

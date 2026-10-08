// ─── Типы визуальных сценариев (Flow) ────────────────────────────────────────

export type FlowNodeType =
  | 'start'
  | 'message'
  | 'question'
  | 'buttons'
  | 'condition'
  | 'ai'
  | 'http'
  | 'delay'
  | 'handoff'
  | 'end';

export type ConditionOp =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'gt'
  | 'lt'
  | 'empty'
  | 'not_empty';

export interface FlowButton {
  id: string;
  text: string;
}

export interface FlowNodeData {
  label?: string;
  text?: string;
  variable?: string;
  /**
   * Автопроверка ответа на вопрос:
   *  phone — телефон РФ (10–11 цифр); address — адрес существует (геокодинг).
   *  При ошибке бот переспрашивает; «пропустить» принимает ответ без проверки.
   */
  validate?: 'phone' | 'address';
  buttons?: FlowButton[];
  /** Сохранить текст выбранной кнопки в переменную (выбор из меню) */
  saveSelection?: string;
  condition?: {
    left: string;
    op: ConditionOp;
    right: string;
  };
  prompt?: string;
  knowledge?: string;
  useMemory?: boolean;
  /** Дополнять базу знаний узла общей базой знаний ИИ-ассистента бота */
  useBotKnowledge?: boolean;
  url?: string;
  method?: string;
  body?: string;
  seconds?: number;
  /** Создать заявку перед показом сообщения (номер → {{order.number}}) */
  createOrder?: {
    type?: 'waste' | 'kgm' | 'other';
    /** Переменная с именем клиента */
    nameVar?: string;
    phoneVar?: string;
    /** Переменная с городом (выбор города обслуживания) */
    cityVar?: string;
    /**
     * Переменная с адресом или шаблон «{{city}}, {{street}}» —
     * полный адрес нужен для точного геокодинга на карте.
     */
    addressVar?: string;
    /** Объём контейнера / состав предметов */
    sizeVar?: string;
    dateVar?: string;
    /** Статичный комментарий (может содержать {{переменные}}) */
    comment?: string;
  };
  /**
   * IMP-23-BE-04: зарегистрировать жалобу перед показом сообщения
   * (номер → {{complaint.number}}). Может соседствовать с createOrder —
   * в этом случае создаются и заявка, и жалоба.
   */
  createComplaint?: {
    /** Фиксированный тип, если не задан typeVar */
    type?: 'no_pickup' | 'damaged' | 'overflow' | 'other';
    /**
     * Переменная с типом проблемы (например, из меню кнопок c saveSelection).
     * Значение мапится по ключевым словам:
     *  «вывез|вывоз» → no_pickup, «поврежд|сломан|разбит» → damaged,
     *  «переполн» → overflow, иначе other.
     */
    typeVar?: string;
    /** Переменная с описанием (пусто — берётся текст узла) */
    descriptionVar?: string;
    /** Переменная с датой/временем происшествия (свободный текст) */
    whenVar?: string;
    /**
     * IMP-24-BE-05: переменная с адресом инцидента (пусто/нет — берётся адрес
     * последней заявки этого диалога, чтобы «не вывезли» не потеряло место).
     */
    addressVar?: string;
    /** IMP-24-BE-05: переменная с городом — уточняет геокодинг адреса жалобы */
    cityVar?: string;
  };
}

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ─── Состояние движка (память диалога) ───────────────────────────────────────

export interface EngineHistoryItem {
  role: 'user' | 'bot';
  text: string;
}

export interface EngineState {
  currentNodeId: string | null;
  waiting: 'none' | 'input' | 'buttons';
  vars: Record<string, string>;
  history: EngineHistoryItem[];
}

export interface EngineMessage {
  text: string;
  nodeId: string;
  buttons?: FlowButton[];
}

export interface EngineResult {
  messages: EngineMessage[];
  state: EngineState;
  needsOperator: boolean;
}

// ─── Метаданные типов узлов (для палитры и редактора) ────────────────────────

export const NODE_META: Record<
  FlowNodeType,
  { title: string; description: string; color: string; bg: string }
> = {
  start: {
    title: 'Старт',
    description: 'Точка входа — любое входящее сообщение',
    color: 'text-emerald-600',
    bg: 'bg-emerald-100',
  },
  message: {
    title: 'Сообщение',
    description: 'Отправить текст пользователю',
    color: 'text-teal-600',
    bg: 'bg-teal-100',
  },
  question: {
    title: 'Вопрос',
    description: 'Задать вопрос и сохранить ответ в переменную',
    color: 'text-cyan-600',
    bg: 'bg-cyan-100',
  },
  buttons: {
    title: 'Кнопки',
    description: 'Меню с вариантами ответа',
    color: 'text-amber-600',
    bg: 'bg-amber-100',
  },
  condition: {
    title: 'Условие',
    description: 'Ветвление по переменной',
    color: 'text-orange-600',
    bg: 'bg-orange-100',
  },
  ai: {
    title: 'ИИ-ответ',
    description: 'Ответ от нейросети с памятью и базой знаний',
    color: 'text-violet-600',
    bg: 'bg-violet-100',
  },
  http: {
    title: 'HTTP-запрос',
    description: 'Вызвать внешний API / вебхук',
    color: 'text-fuchsia-600',
    bg: 'bg-fuchsia-100',
  },
  delay: {
    title: 'Пауза',
    description: 'Подождать несколько секунд',
    color: 'text-slate-600',
    bg: 'bg-slate-200',
  },
  handoff: {
    title: 'Оператор',
    description: 'Передать диалог живому оператору',
    color: 'text-rose-600',
    bg: 'bg-rose-100',
  },
  end: {
    title: 'Конец',
    description: 'Завершить сценарий',
    color: 'text-slate-600',
    bg: 'bg-slate-200',
  },
};

export const CONDITION_OP_LABELS: Record<ConditionOp, string> = {
  eq: 'равно',
  neq: 'не равно',
  contains: 'содержит',
  not_contains: 'не содержит',
  gt: 'больше',
  lt: 'меньше',
  empty: 'пусто',
  not_empty: 'не пусто',
};

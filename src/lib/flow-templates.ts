// ─── Шаблоны сценариев для новых ботов (волна 30, IMP-30-01) ─────────────────
//
// Каждый шаблон — фабрика Flow, которую POST /api/bots сериализует в Bot.flow,
// а конструктор открывает как обычный редактируемый сценарий.
//
// Правила сборки (сверено с аудитом 30-A2 и flow-validate.ts):
//  • sourceHandle: у buttons-рёбер = button.id кнопки; у condition — строго
//    'yes'/'no'; у question/message/ai/http/delay/handoff — ребро БЕЗ
//    sourceHandle. У КАЖДОЙ кнопки и ОБЕИХ веток condition обязано быть
//    исходящее ребро — валидатор висячие кнопки не ловит, бот просто молчит.
//  • var-имена латиницей/underscore (^[a-zA-Z_][\w.]*$, ≤100), кнопки ≤20,
//    тексты ≤4000, delay seconds 0–3.
//  • createOrder/createComplaint живут ТОЛЬКО на message-узлах
//    (data.createOrder / data.createComplaint) — отдельного типа узла нет.
//  • Ошибки плагинов → {{order_error}}/{{complaint_error}} = 'true'
//    (движок сбрасывает в 'false' при успехе) — условие eq 'true'.
//  • Координаты сеткой: x 120–780, y шаг ~120–160; длинные цепочки — колонками
//    (основная x=420, ветка ошибки/ИИ x=120, ветка оператора/жалоб x=720).

import type { Flow, FlowEdge, FlowNode, FlowNodeData, FlowNodeType } from './flow-types';

export type FlowTemplateId = 'universal' | 'tko' | 'booking' | 'faq' | 'empty';

export interface FlowTemplateMeta {
  id: FlowTemplateId;
  name: string;
  emoji: string;
  description: string;
}

/**
 * Реестр шаблонов. Порядок массива = порядок карточек в диалоге создания бота
 * (dashboard.tsx) — не перемешивать без нужды.
 */
export const FLOW_TEMPLATES: FlowTemplateMeta[] = [
  {
    id: 'universal',
    emoji: '🛟',
    name: 'Универсальная поддержка',
    description: 'Приветствие, меню, ИИ-ответы на частые вопросы и передача оператору — подходит почти любому боту.',
  },
  {
    id: 'tko',
    emoji: '🚛',
    name: 'Вывоз отходов и КГМ',
    description: 'Заявка на вывоз (адрес, дата, объём) с автоназначением экипажа плюс ветка приёма жалоб.',
  },
  {
    id: 'booking',
    emoji: '📅',
    name: 'Запись и бронирование',
    description: 'Запись клиента на услугу: имя, услуга, дата и телефон — с созданием обращения.',
  },
  {
    id: 'faq',
    emoji: '💬',
    name: 'FAQ + ИИ-ассистент',
    description: 'Бот-справочник: отвечает на вопросы по базе знаний, эскалация живому оператору.',
  },
  {
    id: 'empty',
    emoji: '⚪',
    name: 'Пустой',
    description: 'Чистый лист: только старт и конец — соберите сценарий сами в конструкторе.',
  },
];

/** Устойчивая проверка из API: unknown → boolean, без исключений */
export function isFlowTemplateId(v: unknown): v is FlowTemplateId {
  return typeof v === 'string' && FLOW_TEMPLATES.some((t) => t.id === v);
}

/** Точка входа: собрать Flow по id шаблона (неизвестный id → universal) */
export function buildTemplateFlow(id: FlowTemplateId): Flow {
  switch (id) {
    case 'tko':
      return buildTkoFlow();
    case 'booking':
      return buildBookingFlow();
    case 'faq':
      return buildFaqFlow();
    case 'empty':
      return buildEmptyFlow();
    case 'universal':
    default:
      return buildUniversalFlow();
  }
}

// ─── Хелперы сборки ───────────────────────────────────────────────────────────

function node(id: string, type: FlowNodeType, x: number, y: number, data: FlowNodeData): FlowNode {
  return { id, type, position: { x, y }, data };
}

/**
 * Ребро. sourceHandle обязателен ТОЛЬКО для кнопок (button.id) и condition
 * ('yes'/'no'); у остальных узлов — безымянное ребро (движок nextNode берёт
 * единственное исходящее).
 */
function edge(id: string, source: string, target: string, sourceHandle?: string): FlowEdge {
  return sourceHandle !== undefined
    ? { id, source, target, sourceHandle }
    : { id, source, target };
}

function question(
  id: string,
  x: number,
  y: number,
  label: string,
  text: string,
  variable: string,
  validate?: 'phone' | 'address'
): FlowNode {
  return node(id, 'question', x, y, validate ? { label, text, variable, validate } : { label, text, variable });
}

// ─── «Универсальная поддержка» (дефолт, обратная совместимость) ──────────────

/**
 * Бывший defaultFlow() из flow-engine.ts — поведение сохранено 1:1
 * (тексты, knowledge, координаты), чтобы существующие боты и тесты не поехали.
 */
function buildUniversalFlow(): Flow {
  const nodes: FlowNode[] = [
    node('n_start', 'start', 420, 0, { label: 'Старт' }),
    node('n_greet', 'message', 380, 110, {
      label: 'Приветствие',
      text: 'Здравствуйте! 👋 Я бот техподдержки. Чем могу помочь?',
    }),
    node('n_menu', 'buttons', 380, 240, {
      label: 'Главное меню',
      text: 'Выберите, что вас интересует:',
      buttons: [
        { id: 'b1', text: '❓ Частый вопрос' },
        { id: 'b2', text: '👤 Оператор' },
      ],
    }),
    node('n_ai', 'ai', 120, 400, {
      label: 'ИИ-поддержка',
      prompt:
        'Ты — дружелюбный бот техподдержки компании. Отвечай кратко, вежливо и по делу. Если вопрос выходит за рамки базы знаний — предложи связаться с оператором.',
      knowledge:
        'Часы работы поддержки: пн–пт, 9:00–18:00 МСК.\nВозврат средств — в течение 14 дней с момента покупки.\nСрок доставки — 2–5 рабочих дней.\nEmail поддержки: support@example.com',
      useMemory: true,
    }),
    node('n_more', 'buttons', 120, 560, {
      label: 'Ещё помощь?',
      text: 'Могу ли я ещё чем-то помочь?',
      buttons: [
        { id: 'b1', text: 'Да, ещё вопрос' },
        { id: 'b2', text: 'Нет, спасибо' },
      ],
    }),
    node('n_bye', 'message', 420, 720, {
      label: 'Прощание',
      text: 'Спасибо за обращение! Хорошего дня 😊',
    }),
    node('n_handoff', 'handoff', 680, 400, {
      label: 'Передача оператору',
      text: 'Передаю диалог живому оператору…',
    }),
    node('n_end', 'end', 420, 840, { label: 'Конец' }),
  ];
  const edges: FlowEdge[] = [
    edge('e1', 'n_start', 'n_greet'),
    edge('e2', 'n_greet', 'n_menu'),
    edge('e3', 'n_menu', 'n_ai', 'b1'),
    edge('e4', 'n_menu', 'n_handoff', 'b2'),
    edge('e5', 'n_ai', 'n_more'),
    edge('e6', 'n_more', 'n_menu', 'b1'),
    edge('e7', 'n_more', 'n_bye', 'b2'),
    edge('e8', 'n_handoff', 'n_end'),
    edge('e9', 'n_bye', 'n_end'),
  ];
  return { nodes, edges };
}

// ─── «Вывоз отходов и КГМ» ────────────────────────────────────────────────────

/**
 * Колонки: основная (заявка) x=420, ошибка заявки x=120, жалобы/оператор x=720.
 * Кнопки объёма и типа жалобы все ведут в следующий узел — значение выбирается
 * через saveSelection ('container' / 'cmp_type'); тип жалобы движок мапит по
 * ключевым словам («вывез» → no_pickup, «поврежд» → damaged, «переполн» → overflow).
 */
function buildTkoFlow(): Flow {
  const nodes: FlowNode[] = [
    node('n_start', 'start', 420, 0, { label: 'Старт' }),
    node('n_greet', 'message', 420, 120, {
      label: 'Приветствие',
      text: 'Здравствуйте! 👋 Я бот службы вывоза отходов. Оформлю заявку на вывоз мусора или КГМ, приму жалобу и отвечу на вопросы.',
    }),
    node('n_menu', 'buttons', 420, 260, {
      label: 'Главное меню',
      text: 'Выберите, что вас интересует:',
      buttons: [
        { id: 'b1', text: '🚛 Заказать вывоз' },
        { id: 'b2', text: '⚠️ Жалоба' },
        { id: 'b3', text: '👤 Оператор' },
      ],
    }),
    question('n_o_name', 420, 420, 'Имя клиента', 'Как вас зовут?', 'name'),
    question('n_o_city', 420, 560, 'Город обслуживания', 'Из какого вы города? (Великий Новгород, Боровичи, Валдай…)', 'city'),
    question('n_o_addr', 420, 700, 'Адрес вывоза', 'Укажите адрес вывоза (улица, дом)', 'address', 'address'),
    question('n_o_date', 420, 840, 'Дата вывоза', 'На какую дату заказать вывоз?', 'date'),
    question('n_o_phone', 420, 980, 'Телефон', 'Оставьте телефон для связи с экипажем', 'phone', 'phone'),
    node('n_o_size', 'buttons', 420, 1120, {
      label: 'Объём вывоза',
      text: 'Какой объём нужно вывезти?',
      saveSelection: 'container',
      buttons: [
        { id: 'b1', text: '0.8 м³' },
        { id: 'b2', text: '1.1 м³' },
        { id: 'b3', text: '20 м³' },
        { id: 'b4', text: 'КГМ (крупногабарит)' },
      ],
    }),
    node('n_o_done', 'message', 420, 1280, {
      label: 'Заявка создана',
      text: 'Заявка №{{order.number}} принята! 🚛 {{date}} — {{address}}, {{city}}. Мы позвоним по номеру {{phone}} для подтверждения.',
      createOrder: {
        type: 'waste',
        nameVar: 'name',
        phoneVar: 'phone',
        cityVar: 'city',
        addressVar: 'address',
        sizeVar: 'container',
        dateVar: 'date',
        autoAssignCrew: true,
      },
    }),
    node('n_o_err_check', 'condition', 420, 1420, {
      label: 'Заявка создалась?',
      condition: { left: '{{order_error}}', op: 'eq', right: 'true' },
    }),
    node('n_o_err', 'message', 120, 1560, {
      label: 'Ошибка заявки',
      text: 'Не удалось создать заявку 😔 Попробуйте ещё раз позже или вернитесь в меню.',
    }),
    node('n_c_menu', 'buttons', 720, 420, {
      label: 'Тип жалобы',
      text: 'Что произошло?',
      saveSelection: 'cmp_type',
      buttons: [
        { id: 'b1', text: 'Не вывезли мусор' },
        { id: 'b2', text: 'Контейнер повреждён' },
        { id: 'b3', text: 'Переполнена площадка' },
        { id: 'b4', text: 'Другая проблема' },
      ],
    }),
    question('n_c_desc', 720, 570, 'Описание', 'Опишите проблему подробнее', 'cmp_desc'),
    question('n_c_when', 720, 710, 'Когда произошло', 'Когда произошло? (вчера, сегодня, дата)', 'cmp_when'),
    question('n_c_addr', 720, 850, 'Адрес инцидента', 'Укажите адрес инцидента (улица, дом)', 'cmp_addr', 'address'),
    node('n_c_done', 'message', 720, 1000, {
      label: 'Жалоба принята',
      text: 'Жалоба №{{complaint.number}} принята. Мы разберёмся и сообщим вам о результате.',
      createComplaint: {
        typeVar: 'cmp_type',
        descriptionVar: 'cmp_desc',
        whenVar: 'cmp_when',
        addressVar: 'cmp_addr',
        cityVar: 'city',
      },
    }),
    node('n_handoff', 'handoff', 720, 1150, {
      label: 'Передача оператору',
      text: 'Передаю диалог живому оператору…',
    }),
    node('n_end', 'end', 720, 1300, { label: 'Конец' }),
  ];
  const edges: FlowEdge[] = [
    edge('e1', 'n_start', 'n_greet'),
    edge('e2', 'n_greet', 'n_menu'),
    edge('e3', 'n_menu', 'n_o_name', 'b1'),
    edge('e4', 'n_menu', 'n_c_menu', 'b2'),
    edge('e5', 'n_menu', 'n_handoff', 'b3'),
    edge('e6', 'n_o_name', 'n_o_city'),
    edge('e7', 'n_o_city', 'n_o_addr'),
    edge('e8', 'n_o_addr', 'n_o_date'),
    edge('e9', 'n_o_date', 'n_o_phone'),
    edge('e10', 'n_o_phone', 'n_o_size'),
    edge('e11', 'n_o_size', 'n_o_done', 'b1'),
    edge('e12', 'n_o_size', 'n_o_done', 'b2'),
    edge('e13', 'n_o_size', 'n_o_done', 'b3'),
    edge('e14', 'n_o_size', 'n_o_done', 'b4'),
    edge('e15', 'n_o_done', 'n_o_err_check'),
    edge('e16', 'n_o_err_check', 'n_o_err', 'yes'),
    edge('e17', 'n_o_err_check', 'n_menu', 'no'),
    edge('e18', 'n_o_err', 'n_menu'),
    edge('e19', 'n_c_menu', 'n_c_desc', 'b1'),
    edge('e20', 'n_c_menu', 'n_c_desc', 'b2'),
    edge('e21', 'n_c_menu', 'n_c_desc', 'b3'),
    edge('e22', 'n_c_menu', 'n_c_desc', 'b4'),
    edge('e23', 'n_c_desc', 'n_c_when'),
    edge('e24', 'n_c_when', 'n_c_addr'),
    edge('e25', 'n_c_addr', 'n_c_done'),
    edge('e26', 'n_c_done', 'n_menu'),
    edge('e27', 'n_handoff', 'n_end'),
  ];
  return { nodes, edges };
}

// ─── «Запись и бронирование» ─────────────────────────────────────────────────

/**
 * Услуга — свободный вопрос ('service') и подставляется в текст подтверждения
 * через {{service}} (sizeVar/комментарий для этого не годятся).
 */
function buildBookingFlow(): Flow {
  const nodes: FlowNode[] = [
    node('n_start', 'start', 420, 0, { label: 'Старт' }),
    node('n_greet', 'message', 420, 120, {
      label: 'Приветствие',
      text: 'Здравствуйте! 👋 Я бот записи. Помогу записать вас на услугу, а если понадобится — позову живого оператора.',
    }),
    node('n_b_menu', 'buttons', 420, 260, {
      label: 'Главное меню',
      text: 'Выберите, что вас интересует:',
      buttons: [
        { id: 'b1', text: '📝 Записаться' },
        { id: 'b2', text: '👤 Оператор' },
      ],
    }),
    question('n_b_name', 420, 420, 'Имя клиента', 'Как вас зовут?', 'name'),
    question('n_b_service', 420, 560, 'Услуга', 'Что хотите? (услуга или имя специалиста)', 'service'),
    question('n_b_date', 420, 700, 'Дата и время', 'На какую дату и время вас записать?', 'date'),
    question('n_b_phone', 420, 840, 'Телефон', 'Оставьте телефон для подтверждения записи', 'phone', 'phone'),
    node('n_b_done', 'message', 420, 990, {
      label: 'Запись создана',
      text: 'Вы записаны! ✅ Номер обращения №{{order.number}}. {{name}}, ждём вас {{date}} — услуга: {{service}}. Мы позвоним по номеру {{phone}} для подтверждения.',
      createOrder: {
        type: 'other',
        nameVar: 'name',
        phoneVar: 'phone',
        dateVar: 'date',
      },
    }),
    node('n_b_check', 'condition', 420, 1130, {
      label: 'Запись создалась?',
      condition: { left: '{{order_error}}', op: 'eq', right: 'true' },
    }),
    node('n_b_err', 'message', 120, 1270, {
      label: 'Ошибка записи',
      text: 'Не удалось оформить запись 😔 Попробуйте ещё раз позже или вернитесь в меню.',
    }),
    node('n_handoff', 'handoff', 720, 420, {
      label: 'Передача оператору',
      text: 'Передаю диалог живому оператору…',
    }),
    node('n_end', 'end', 720, 570, { label: 'Конец' }),
  ];
  const edges: FlowEdge[] = [
    edge('e1', 'n_start', 'n_greet'),
    edge('e2', 'n_greet', 'n_b_menu'),
    edge('e3', 'n_b_menu', 'n_b_name', 'b1'),
    edge('e4', 'n_b_menu', 'n_handoff', 'b2'),
    edge('e5', 'n_b_name', 'n_b_service'),
    edge('e6', 'n_b_service', 'n_b_date'),
    edge('e7', 'n_b_date', 'n_b_phone'),
    edge('e8', 'n_b_phone', 'n_b_done'),
    edge('e9', 'n_b_done', 'n_b_check'),
    edge('e10', 'n_b_check', 'n_b_err', 'yes'),
    edge('e11', 'n_b_check', 'n_b_menu', 'no'),
    edge('e12', 'n_b_err', 'n_b_menu'),
    edge('e13', 'n_handoff', 'n_end'),
  ];
  return { nodes, edges };
}

// ─── «FAQ + ИИ-ассистент» ─────────────────────────────────────────────────────

/** Как universal, но упор на ИИ-справку; knowledge — те же дефолтные FAQ-строки */
function buildFaqFlow(): Flow {
  const nodes: FlowNode[] = [
    node('n_start', 'start', 420, 0, { label: 'Старт' }),
    node('n_greet', 'message', 420, 120, {
      label: 'Приветствие',
      text: 'Здравствуйте! 👋 Я бот справочной службы. Задайте вопрос — постараюсь ответить, или позову живого оператора.',
    }),
    node('n_f_menu', 'buttons', 420, 260, {
      label: 'Главное меню',
      text: 'Выберите, что вас интересует:',
      buttons: [
        { id: 'b1', text: '💬 Задать вопрос' },
        { id: 'b2', text: '👤 Живой оператор' },
      ],
    }),
    node('n_f_ai', 'ai', 120, 420, {
      label: 'ИИ-справка',
      prompt:
        'Ты — бот справочной службы. Отвечай кратко, точно и вежливо, опираясь на базу знаний. Если ответа нет в базе — честно скажи об этом и предложи связаться с оператором.',
      knowledge:
        'Часы работы поддержки: пн–пт, 9:00–18:00 МСК.\nВозврат средств — в течение 14 дней с момента покупки.\nСрок доставки — 2–5 рабочих дней.\nEmail поддержки: support@example.com',
      useMemory: true,
    }),
    node('n_f_more', 'buttons', 120, 580, {
      label: 'Ещё вопрос?',
      text: 'Могу ли я ещё чем-то помочь?',
      buttons: [
        { id: 'b1', text: 'Ещё вопрос' },
        { id: 'b2', text: 'Нет' },
      ],
    }),
    node('n_f_bye', 'message', 420, 740, {
      label: 'Прощание',
      text: 'Спасибо за обращение! Хорошего дня 😊',
    }),
    node('n_f_handoff', 'handoff', 720, 420, {
      label: 'Передача оператору',
      text: 'Передаю диалог живому оператору…',
    }),
    node('n_f_end', 'end', 420, 880, { label: 'Конец' }),
  ];
  const edges: FlowEdge[] = [
    edge('e1', 'n_start', 'n_greet'),
    edge('e2', 'n_greet', 'n_f_menu'),
    edge('e3', 'n_f_menu', 'n_f_ai', 'b1'),
    edge('e4', 'n_f_menu', 'n_f_handoff', 'b2'),
    edge('e5', 'n_f_ai', 'n_f_more'),
    edge('e6', 'n_f_more', 'n_f_menu', 'b1'),
    edge('e7', 'n_f_more', 'n_f_bye', 'b2'),
    edge('e8', 'n_f_handoff', 'n_f_end'),
    edge('e9', 'n_f_bye', 'n_f_end'),
  ];
  return { nodes, edges };
}

// ─── «Пустой» ────────────────────────────────────────────────────────────────

/** Минимальный каркас: старт → конец, всё остальное пользователь построит сам */
function buildEmptyFlow(): Flow {
  const nodes: FlowNode[] = [
    node('n_start', 'start', 420, 0, { label: 'Старт' }),
    node('n_end', 'end', 420, 140, { label: 'Конец' }),
  ];
  const edges: FlowEdge[] = [edge('e1', 'n_start', 'n_end')];
  return { nodes, edges };
}

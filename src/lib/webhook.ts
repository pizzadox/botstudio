import { db } from '@/lib/db';
import { runEngine, askAssistant, isMainMenuCommand } from '@/lib/flow-engine';
import type { AiAssistantConfig } from '@/lib/flow-engine';
import { loadAssistantConfig } from '@/lib/ai-assistant';
import { getFlowCached } from '@/lib/flow-cache';
import { ORDER_STATUS_LABELS, ORDER_TYPE_LABELS } from '@/lib/orders';
import type { EngineState, Flow } from '@/lib/flow-types';
import type { Conversation } from '@prisma/client';

export interface InboundMessage {
  externalId?: string;
  /**
   * Стабильный идентификатор человека в мессенджере (MAX: user_id).
   * Один человек = одно обращение, даже если chat_id меняется
   * (текстовые сообщения и нажатия кнопок в MAX приходят с разными id).
   */
  externalUserId?: string;
  /** Прямой ID диалога (используется демо-чатом сайта) */
  conversationId?: string;
  text: string;
  contact?: string;
  /**
   * Уникальный ключ входящего сообщения мессенджера (mid / callback_id).
   * Если сообщение с таким ключом уже обработано — повтор не приводит
   * к новому ответу бота (защита от дублей).
   */
  externalKey?: string;
}

export interface OutboundMessage {
  text: string;
  buttons?: { id: string; text: string }[];
}

export type InboundResult =
  | {
      ok: true;
      replies: string[];
      /** Сообщения с кнопками — для мессенджеров с inline-клавиатурой */
      messages: OutboundMessage[];
      conversationId: string;
      /** externalId диалога (для MAX — chat_id, куда отправлять ответы) */
      chatId?: string;
      /** Диалог в режиме «ждёт оператора» — движок молчит */
      needsOperator?: boolean;
      duplicate?: boolean;
    }
  | { ok: false; error: string };

// ─── Режимы беседы пользователя ──────────────────────────────────────────────
// state.vars.__mode: не задан → сценарий (меню); 'orders' → список заявок;
// 'order' → чат по заявке; 'chat' → свободный чат с ИИ. Оператор — needsOperator.

const BTN_MY_ORDERS = '📦 Мои заявки';
const BTN_CALL_OPERATOR = '🎧 Позвать оператора';
const BTN_FREE_CHAT = '💬 Свободный чат';
const BTN_MAIN_MENU = '🏠 Главное меню';

/** Максимальное число рядов inline-клавиатуры MAX */
const MAX_KEYBOARD_ROWS = 8;

function isMyOrdersCommand(text: string): boolean {
  return /^(📦\s*)?мои заявки[.!]?\s*$/i.test(text.trim());
}
function isCallOperatorCommand(text: string): boolean {
  return /^(🎧\s*)?позвать оператора[.!]?\s*$/i.test(text.trim());
}
function isFreeChatCommand(text: string): boolean {
  return /^(💬\s*)?(свободный чат|просто чат|обычный чат)[.!]?\s*$/i.test(text.trim());
}

function dropVar(vars: Record<string, string>, key: string): void {
  if (key in vars) delete vars[key];
}

function btn(id: string, text: string) {
  return { id, text };
}

/**
 * Постоянные кнопки навигации: «Мои заявки» и «🏠 Главное меню» добавляются
 * к последнему сообщению бота, если хватает рядов клавиатуры и их там ещё нет.
 */
function appendPersistentButtons(messages: OutboundMessage[]): void {
  const last = messages[messages.length - 1];
  if (!last) return;
  const buttons = last.buttons ? [...last.buttons] : [];
  const has = (t: string) => buttons.some((b) => b.text.trim() === t);
  const wish = [BTN_MY_ORDERS, BTN_MAIN_MENU];
  for (const t of wish) {
    if (!has(t) && buttons.length < MAX_KEYBOARD_ROWS - 1) {
      buttons.push(btn(`__nav_${buttons.length}`, t));
    }
  }
  if (buttons.length !== (last.buttons?.length ?? 0)) {
    last.buttons = buttons;
  }
}

/** Добавить кнопки, которых ещё нет в сообщении (лимит рядов MAX соблюдается) */
function withButtons(messages: OutboundMessage[], texts: string[]): OutboundMessage[] {
  const last = messages[messages.length - 1];
  if (!last) return messages;
  const buttons = last.buttons ? [...last.buttons] : [];
  for (const t of texts) {
    if (!buttons.some((b) => b.text.trim() === t) && buttons.length < MAX_KEYBOARD_ROWS) {
      buttons.push(btn(`__ctl_${buttons.length}`, t));
    }
  }
  last.buttons = buttons;
  return messages;
}

function statusEmoji(status: string): string {
  switch (status) {
    case 'new':
      return '🆕';
    case 'assigned':
      return '👷';
    case 'in_progress':
      return '🚛';
    case 'completed':
      return '✅';
    case 'cancelled':
      return '❌';
    default:
      return '•';
  }
}

/** Карточка заявки в боте: пользователь видит статус и может написать по ней */
function orderCardText(order: {
  number: number;
  type: string;
  status: string;
  size?: string | null;
  address?: string | null;
  wishDate?: string | null;
  phone?: string | null;
}): string {
  const lines = [
    `📋 Заявка №${order.number} — ${ORDER_TYPE_LABELS[order.type] ?? 'Заявка'}`,
    '',
    `Статус: ${statusEmoji(order.status)} ${ORDER_STATUS_LABELS[order.status] ?? order.status}`,
  ];
  if (order.size) lines.push(`📦 Состав/объём: ${order.size}`);
  if (order.address) lines.push(`📍 Адрес: ${order.address}`);
  if (order.wishDate) lines.push(`🗓 Дата подачи: ${order.wishDate}`);
  if (order.phone) lines.push(`📞 Телефон: ${order.phone}`);
  lines.push('');
  lines.push('💬 Напишите сообщение — оно попадёт в карточку заявки, и оператор ответит вам.');
  return lines.join('\n');
}

/**
 * Мьютекс на диалог: сообщения одного диалога обрабатываются строго
 * последовательно, иначе два одновременных клика/сообщения читают и
 * перезаписывают состояние движка друг друга (гонка → потеря режима
 * оператора, повторные приветствия).
 */
const lockGlobals = globalThis as unknown as {
  __convLocks?: Map<string, Promise<unknown>>;
};
function withConversationLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  const map = (lockGlobals.__convLocks ??= new Map());
  const prev = map.get(conversationId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  const stored = next.catch(() => {});
  map.set(conversationId, stored);
  // Чистка: убираем ключ, только если цепочка не ушла дальше этого промиса
  stored.finally(() => {
    if (map.get(conversationId) === stored) map.delete(conversationId);
  });
  return next;
}

/**
 * Единая точка обработки входящего сообщения из любого мессенджера.
 * Находит/создаёт диалог, сохраняет сообщения, запускает оркестратор сценария.
 *
 * Идентификация диалога (в порядке приоритета):
 *  1. conversationId — прямой ID (демо-чат сайта);
 *  2. externalUserId — человек (MAX: user_id) — главное правило
 *     «один человек = одно обращение»; если чат сменился, externalId
 *     обновляется, чтобы ответы уходили туда, откуда пишет человек;
 *  3. externalId — chat_id (совместимость со старыми диалогами).
 *
 * Режимы беседы (state.vars.__mode): сценарий/меню, список заявок,
 * чат по заявке (сообщение попадает в карточку заявки оператора),
 * свободный чат с ИИ. Кнопки «📦 Мои заявки» и «🏠 Главное меню»
 * доступны пользователю постоянно.
 */
export async function processInbound(channelId: string, msg: InboundMessage): Promise<InboundResult> {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    include: { bot: true },
  });
  if (!channel) return { ok: false, error: 'channel_not_found' };
  if (!channel.active) return { ok: false, error: 'channel_inactive' };
  if (channel.bot.status !== 'published') return { ok: false, error: 'bot_not_published' };

  let conversation: Conversation | null = null;

  // 1. Демо-чат передаёт прямой ID диалога.
  // ГВАРД (IMP-BE21-05): продолжить по conversationId можно ТОЛЬКО диалог
  // веб-канала (демо-виджет сайта). Чужой/подделанный conversationId
  // (MAX/Telegram/симулятор) НЕ инжектится — запрос обрабатывается дальше
  // как будто ID не передавали: гость попадёт в свой веб-диалог по
  // externalUserId или получит новый диалог. Так публичный виджет не может
  // писать в чужие диалоги мессенджеров или в тест-чат из симулятора.
  if (msg.conversationId) {
    const direct = await db.conversation.findFirst({
      where: { id: msg.conversationId, botId: channel.botId },
      include: { channel: { select: { type: true } } },
    });
    // channel может отсутствовать (SetNull после удаления канала) — тогда
    // доверяем source: веб-диалоги всегда создаются с source='web'
    if (direct && (direct.channel?.type ?? direct.source) === 'web') {
      conversation = direct;
    }
  }

  // 2. Мессенджеры: ищем диалог человека (user_id стабильнее, чем chat_id)
  if (!conversation && msg.externalUserId) {
    conversation = await db.conversation.findFirst({
      where: { botId: channel.botId, source: channel.type, externalUserId: msg.externalUserId },
    });
    if (conversation) {
      const freshChatId = msg.externalId && /^\d+$/.test(msg.externalId) ? msg.externalId : null;
      if (freshChatId && conversation.externalId !== freshChatId) {
        // Человек пишет из другого чата (или это первый контакт после legacy) —
        // отвечаем туда, откуда пришло сообщение
        conversation = await db.conversation
          .update({ where: { id: conversation.id }, data: { externalId: freshChatId } })
          .catch(() => conversation);
      }
    }
  }

  // 3. Совместимость: поиск по chat_id (старые диалоги без externalUserId)
  if (!conversation && msg.externalId) {
    conversation = await db.conversation.findUnique({
      where: {
        botId_source_externalId: {
          botId: channel.botId,
          source: channel.type,
          externalId: msg.externalId,
        },
      },
    });
    if (conversation && msg.externalUserId && !conversation.externalUserId) {
      conversation = await db.conversation
        .update({
          where: { id: conversation.id },
          data: { externalUserId: msg.externalUserId },
        })
        .catch(() => conversation);
    }
  }

  if (!conversation) {
    // Новый диалог. Для callback'ов chat_id недоступен — используем
    // плейсхолдер, чтобы unique-ключ не нарушался; при первом же текстовом
    // сообщении он заменится реальным chat_id.
    const externalId =
      msg.externalId ??
      (msg.externalUserId ? `user:${msg.externalUserId}` : undefined);

    if (!externalId) return { ok: false, error: 'no_conversation' };

    try {
      conversation = await db.conversation.create({
        data: {
          botId: channel.botId,
          channelId: channel.id,
          source: channel.type,
          externalId,
          externalUserId: msg.externalUserId ?? null,
          contact: msg.contact ?? null,
        },
      });
    } catch (e) {
      // Гонка создания: другой запрос успел первым — работаем в его диалоге
      if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
        conversation = await db.conversation.findUnique({
          where: {
            botId_source_externalId: {
              botId: channel.botId,
              source: channel.type,
              externalId,
            },
          },
        });
      }
      if (!conversation) throw e;
    }
  }

  // Критическая секция: состояние диалога читаем/пишем только под мьютексом
  const convId = conversation.id;
  return withConversationLock(convId, async (): Promise<InboundResult> => {
    // перечитываем диалог — пока мы брали блокировку, предыдущее сообщение
    // могло обновить состояние (режим оператора, позицию в сценарии)
    const conv = await db.conversation.findUnique({ where: { id: convId } });
    if (!conv) return { ok: false, error: 'conversation_not_found' };
    conversation = conv;

    let state: EngineState | null = null;
    try {
      state = conv.state ? (JSON.parse(conv.state) as EngineState) : null;
    } catch {
      state = null;
    }
    const vars = state?.vars ?? {};
    const mode = typeof vars['__mode'] === 'string' ? vars['__mode'] : 'menu';

    // Сообщения в режиме «чат по заявке» привязываем к заявке —
    // оператор увидит их в карточке заявки
    const orderMessageId = mode === 'order' ? (vars['__orderId'] ?? null) : null;

    try {
      await db.message.create({
        data: {
          conversationId: conv.id,
          role: 'user',
          text: msg.text,
          externalKey: msg.externalKey ?? null,
          orderId: orderMessageId,
        },
      });
    } catch (e) {
      // Нарушение уникальности (conversationId + externalKey) — это дубликат,
      // мессенджер прислал то же сообщение повторно. Отвечать не нужно.
      if (
        e &&
        typeof e === 'object' &&
        'code' in e &&
        (e as { code?: string }).code === 'P2002'
      ) {
        return {
          ok: true,
          replies: [],
          messages: [],
          conversationId: conv.id,
          chatId: conv.externalId ?? undefined,
          needsOperator: conv.needsOperator,
          duplicate: true,
        };
      }
      throw e;
    }

    // Распарсенный сценарий кэшируется по botId+updatedAt (см. flow-cache.ts)
    const flow: Flow = getFlowCached(channel.botId, channel.bot.updatedAt, channel.bot.flow);

    // ИИ-конфиг грузим ЛЕНЬВО: в режимах оператора/заявок/чата по заявке он не нужен,
    // и лишний запрос базы знаний делать не стоит
    let assistantConfig: AiAssistantConfig | null = null;
    const getAssistant = async (): Promise<AiAssistantConfig> => {
      if (!assistantConfig) {
        assistantConfig = await loadAssistantConfig(channel.botId, channel.bot.aiConfig);
      }
      return assistantConfig;
    };

    const replies: string[] = [];
    const messages: OutboundMessage[] = [];
    let needsOperator = conv.needsOperator;

    /** Записать исходящие сообщения бота в БД одним createMany (IMP-BE21-14;
     *  id созданных записей нигде не используются — только текст в replies) */
    const persistBotMessages = async (orderId?: string | null) => {
      if (messages.length === 0) return;
      await db.message.createMany({
        data: messages.map((m) => ({
          conversationId: conv.id,
          role: 'bot',
          text: m.text,
          nodeId: '__bot',
          orderId: orderId ?? null,
        })),
      });
      for (const m of messages) replies.push(m.text);
    };

    /** Сохранить состояние и вернуть результат без запуска движка */
    const finish = async (
      newState: EngineState,
      opts?: { operator?: boolean; orderId?: string | null }
    ): Promise<InboundResult> => {
      const operatorMode = opts?.operator ? true : needsOperator;
      await db.conversation.update({
        where: { id: conv.id },
        data: {
          state: JSON.stringify(newState),
          needsOperator: operatorMode,
          contact: conv.contact ?? msg.contact ?? null,
          channelId: conv.channelId ?? channel.id,
          status: 'open',
          updatedAt: new Date(),
        },
      });
      return {
        ok: true,
        replies,
        messages,
        conversationId: conv.id,
        chatId: conv.externalId ?? undefined,
        needsOperator: operatorMode,
      };
    };

    const baseState = (): EngineState => ({
      currentNodeId: state?.currentNodeId ?? null,
      waiting: state?.waiting ?? 'none',
      vars: { ...vars },
      history: [...(state?.history ?? [])].slice(-24),
    });

    const pushBot = (text: string) => messages.push({ text, buttons: [] });

    // ─── Диалог передан оператору: бот молчит ────────────────────────────────
    if (needsOperator) {
      return finish(baseState());
    }

    const text = msg.text.trim();

    // ─── Постоянные команды навигации (в любом режиме) ───────────────────────
    if (isMainMenuCommand(text)) {
      const st = baseState();
      dropVar(st.vars, '__mode');
      dropVar(st.vars, '__orderId');
      dropVar(st.vars, '__orderNumber');
      st.waiting = 'none';
      st.currentNodeId = null;
      const result = await runEngine(flow, '/start', st, await getAssistant(), {
        botId: channel.botId,
        conversationId: conv.id,
        externalUserId: conv.externalUserId,
      });
      for (const m of result.messages) messages.push({ text: m.text, buttons: m.buttons });
      appendPersistentButtons(messages);
      await persistBotMessages();
      return finish(result.state);
    }

    if (isMyOrdersCommand(text)) {
      const st = baseState();
      st.vars['__mode'] = 'orders';
      dropVar(st.vars, '__orderId');
      dropVar(st.vars, '__orderNumber');

      const orders = await db.order.findMany({
        where: {
          botId: channel.botId,
          externalUserId: conv.externalUserId ?? '__none__',
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      if (orders.length === 0) {
        pushBot(
          'У вас пока нет заявок 📭\n\nОформить заявку можно в главном меню: «🚛 Заказать вывоз отходов» или «📦 Вывоз КГМ».'
        );
        // Клик по тексту кнопки совпадёт с пунктом главного меню — движок сам продолжит сценарий
        const menuId = st.vars['__last_menu'] ?? null;
        messages[0].buttons = [btn('__o1', '🚛 Заказать вывоз отходов'), btn('__o2', '📦 Вывоз КГМ')];
        st.waiting = menuId ? 'buttons' : 'none';
        st.currentNodeId = menuId;
        withButtons(messages, [BTN_CALL_OPERATOR, BTN_MAIN_MENU]);
        await persistBotMessages();
        return finish(st);
      }

      pushBot(
        `📋 Ваши заявки (${orders.length}) — выберите номер, чтобы открыть карточку и написать по ней:`
      );
      messages[0].buttons = orders.map((o, i) =>
        btn(
          `__order_${i}`,
          `№${o.number} · ${ORDER_TYPE_LABELS[o.type] ?? 'Заявка'} · ${ORDER_STATUS_LABELS[o.status] ?? o.status}`
        )
      );
      st.waiting = 'buttons';
      st.currentNodeId = '__orders_view';
      withButtons(messages, [BTN_FREE_CHAT, BTN_CALL_OPERATOR, BTN_MAIN_MENU]);
      await persistBotMessages();
      return finish(st);
    }

    if (isCallOperatorCommand(text)) {
      const st = baseState();
      st.vars['__operator'] = 'true';
      dropVar(st.vars, '__mode');
      st.waiting = 'none';
      st.currentNodeId = null;
      pushBot(
        'Соединяю вас с живым оператором 🙌\n\nВсе ваши сообщения теперь передаются оператору. Если все операторы заняты — напишите вопрос, ответим, как только освободимся.'
      );
      await persistBotMessages();
      return finish(st, { operator: true });
    }

    if (isFreeChatCommand(text)) {
      const st = baseState();
      st.vars['__mode'] = 'chat';
      st.waiting = 'none';
      st.currentNodeId = null;
      const assistant = await getAssistant();
      if (assistant.enabled) {
        pushBot('💬 Свободный чат: спрашивайте что угодно — отвечу сразу.');
        withButtons(messages, [BTN_MY_ORDERS, BTN_CALL_OPERATOR, BTN_MAIN_MENU]);
        await persistBotMessages();
        return finish(st);
      }
      pushBot(
        'Свободный чат недоступен — ИИ-ассистент выключен в настройках бота ⚙️'
      );
      withButtons(messages, [BTN_MY_ORDERS, BTN_MAIN_MENU]);
      await persistBotMessages();
      return finish(st);
    }

    // ─── Режим: список заявок (выбор заявки кнопкой «№N · …») ────────────────
    if (mode === 'orders') {
      const st = baseState();
      const m = text.match(/^№\s*(\d+)/);
      const num = m ? parseInt(m[1], 10) : NaN;
      const order = Number.isFinite(num)
        ? await db.order.findFirst({
            where: {
              botId: channel.botId,
              number: num,
              externalUserId: conv.externalUserId ?? '__none__',
            },
          })
        : null;
      if (order) {
        st.vars['__mode'] = 'order';
        st.vars['__orderId'] = order.id;
        st.vars['__orderNumber'] = String(order.number);
        pushBot(orderCardText(order));
        messages[0].buttons = [
          btn('__c1', BTN_CALL_OPERATOR),
          btn('__c2', BTN_FREE_CHAT),
          btn('__c3', BTN_MY_ORDERS),
          btn('__c4', BTN_MAIN_MENU),
        ];
        st.waiting = 'buttons';
        st.currentNodeId = '__order_view';
        await persistBotMessages();
        return finish(st);
      }
      // Не распознали выбор — показываем список снова
      pushBot('Не нашёл заявку по запросу 🤔 Выберите номер из списка:');
      const orders = await db.order.findMany({
        where: {
          botId: channel.botId,
          externalUserId: conv.externalUserId ?? '__none__',
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      messages[0].buttons = orders.map((o, i) =>
        btn(
          `__order_${i}`,
          `№${o.number} · ${ORDER_TYPE_LABELS[o.type] ?? 'Заявка'} · ${ORDER_STATUS_LABELS[o.status] ?? o.status}`
        )
      );
      st.waiting = 'buttons';
      st.currentNodeId = '__orders_view';
      withButtons(messages, [BTN_MAIN_MENU]);
      await persistBotMessages();
      return finish(st);
    }

    // ─── Режим: чат по заявке — сообщение уже сохранено с orderId ────────────
    if (mode === 'order' && vars['__orderId']) {
      const order = await db.order.findUnique({ where: { id: vars['__orderId'] } });
      if (order && order.botId === channel.botId) {
        // Тишина бота: сообщение видно оператору в карточке заявки и инбоксе
        const st = baseState();
        return finish(st);
      }
      // Заявка удалена — выходим из режима
      const st = baseState();
      dropVar(st.vars, '__mode');
      dropVar(st.vars, '__orderId');
      pushBot('Эта заявка больше не доступна. Ваши заявки — «📦 Мои заявки».');
      withButtons(messages, [BTN_MY_ORDERS, BTN_MAIN_MENU]);
      await persistBotMessages();
      return finish(st);
    }

    // ─── Режим: свободный чат с ИИ ────────────────────────────────────────────
    if (mode === 'chat') {
      const st = baseState();
      st.history.push({ role: 'user', text: msg.text });
      const assistant = await getAssistant();
      const answer = assistant.enabled ? await askAssistant(assistant, st, msg.text) : null;

      if (answer && answer.toUpperCase().includes('OPERATOR_REQUEST')) {
        st.vars['__operator'] = 'true';
        dropVar(st.vars, '__mode');
        pushBot('Соединяю вас с живым оператором, оставайтесь на линии 🙌');
        await persistBotMessages();
        return finish(st, { operator: true });
      }

      if (!answer) {
        pushBot(
          'Извините, сервис ИИ временно недоступен. Попробуйте задать вопрос ещё раз через минуту.'
        );
        withButtons(messages, [BTN_MY_ORDERS, BTN_MAIN_MENU]);
        await persistBotMessages();
        return finish(st);
      }

      st.history.push({ role: 'bot', text: answer });
      pushBot(answer);
      withButtons(messages, [BTN_MY_ORDERS, BTN_CALL_OPERATOR, BTN_MAIN_MENU]);
      await persistBotMessages();
      return finish(st);
    }

    // ─── Обычный режим: выполнение сценария ──────────────────────────────────
    const result = await runEngine(flow, msg.text, state, await getAssistant(), {
      botId: channel.botId,
      conversationId: conv.id,
      externalUserId: conv.externalUserId,
    });
    for (const m of result.messages) messages.push({ text: m.text, buttons: m.buttons });
    // handoff-узел сценария — поднимаем флаг оператора и в БД (не только в state)
    if (result.needsOperator) {
      needsOperator = true;
    } else {
      appendPersistentButtons(messages);
    }
    await persistBotMessages();
    return finish(result.state);
  });
}

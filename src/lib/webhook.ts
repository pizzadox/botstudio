import { db } from '@/lib/db';
import { runEngine } from '@/lib/flow-engine';
import { loadAssistantConfig } from '@/lib/ai-assistant';
import type { EngineState, Flow } from '@/lib/flow-types';

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
 */
export async function processInbound(channelId: string, msg: InboundMessage): Promise<InboundResult> {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    include: { bot: true },
  });
  if (!channel) return { ok: false, error: 'channel_not_found' };
  if (!channel.active) return { ok: false, error: 'channel_inactive' };
  if (channel.bot.status !== 'published') return { ok: false, error: 'bot_not_published' };

  let conversation = null;

  // 1. Демо-чат передаёт прямой ID диалога
  if (msg.conversationId) {
    conversation = await db.conversation.findFirst({
      where: { id: msg.conversationId, botId: channel.botId },
    });
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
  return withConversationLock(conversation.id, async (): Promise<InboundResult> => {
    // перечитываем диалог — пока мы брали блокировку, предыдущее сообщение
    // могло обновить состояние (режим оператора, позицию в сценарии)
    conversation = await db.conversation.findUnique({ where: { id: conversation.id } });
    if (!conversation) return { ok: false, error: 'conversation_not_found' };

    try {
      await db.message.create({
        data: {
          conversationId: conversation.id,
          role: 'user',
          text: msg.text,
          externalKey: msg.externalKey ?? null,
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
          conversationId: conversation.id,
          chatId: conversation.externalId ?? undefined,
          needsOperator: conversation.needsOperator,
          duplicate: true,
        };
      }
      throw e;
    }

    let state: EngineState | null = null;
    try {
      state = conversation.state ? (JSON.parse(conversation.state) as EngineState) : null;
    } catch {
      state = null;
    }

    let flow: Flow = { nodes: [], edges: [] };
    try {
      flow = JSON.parse(channel.bot.flow) as Flow;
    } catch {
      flow = { nodes: [], edges: [] };
    }

    // ИИ-ассистент бота: отвечает на свободные вопросы, если включён
    const assistant = await loadAssistantConfig(channel.botId, channel.bot.aiConfig);
    const result = await runEngine(flow, msg.text, state, assistant);

    const replies: string[] = [];
    const messages: OutboundMessage[] = [];
    for (const m of result.messages) {
      await db.message.create({
        data: { conversationId: conversation.id, role: 'bot', text: m.text, nodeId: m.nodeId },
      });
      replies.push(m.text);
      messages.push({ text: m.text, buttons: m.buttons });
    }

    const operatorMode = result.needsOperator ? true : conversation.needsOperator;

    await db.conversation.update({
      where: { id: conversation.id },
      data: {
        state: JSON.stringify(result.state),
        needsOperator: operatorMode,
        contact: conversation.contact ?? msg.contact ?? null,
        channelId: conversation.channelId ?? channel.id,
        // новое сообщение от клиента снова открывает обращение в инбоксе
        status: 'open',
        updatedAt: new Date(),
      },
    });

    return {
      ok: true,
      replies,
      messages,
      conversationId: conversation.id,
      chatId: conversation.externalId ?? undefined,
      needsOperator: operatorMode,
    };
  });
}

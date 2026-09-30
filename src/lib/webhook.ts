import { db } from '@/lib/db';
import { runEngine } from '@/lib/flow-engine';
import type { EngineState, Flow } from '@/lib/flow-types';

export interface InboundMessage {
  externalId?: string;
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
      duplicate?: boolean;
    }
  | { ok: false; error: string };

/**
 * Единая точка обработки входящего сообщения из любого мессенджера.
 * Находит/создаёт диалог, сохраняет сообщения, запускает оркестратор сценария.
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

  // Демо-чат передаёт прямой ID диалога
  if (msg.conversationId) {
    conversation = await db.conversation.findFirst({
      where: { id: msg.conversationId, botId: channel.botId },
    });
  }

  // Мессенджеры идентифицируются по внешнему ID чата
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
  }

  if (!conversation && msg.externalId) {
    conversation = await db.conversation.create({
      data: {
        botId: channel.botId,
        channelId: channel.id,
        source: channel.type,
        externalId: msg.externalId,
        contact: msg.contact ?? null,
      },
    });
  }

  if (!conversation) return { ok: false, error: 'no_conversation' };

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

  const result = await runEngine(flow, msg.text, state);

  const replies: string[] = [];
  const messages: OutboundMessage[] = [];
  for (const m of result.messages) {
    await db.message.create({
      data: { conversationId: conversation.id, role: 'bot', text: m.text, nodeId: m.nodeId },
    });
    replies.push(m.text);
    messages.push({ text: m.text, buttons: m.buttons });
  }

  await db.conversation.update({
    where: { id: conversation.id },
    data: {
      state: JSON.stringify(result.state),
      needsOperator: result.needsOperator ? true : conversation.needsOperator,
      contact: conversation.contact ?? msg.contact ?? null,
      updatedAt: new Date(),
    },
  });

  return { ok: true, replies, messages, conversationId: conversation.id };
}

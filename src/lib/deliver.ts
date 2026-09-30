import { db } from '@/lib/db';
import { maxSendMessage } from '@/lib/max-api';

/**
 * Доставка сообщения оператора / системных уведомлений клиенту
 * в его мессенджер. Сообщение в БД сохраняется вызывающим кодом —
 * здесь только отправка «наружу».
 */

export interface DeliverResult {
  delivered: boolean;
  error?: string;
}

/** chat_id в мессенджерах — число; плейсхолдеры (user:...) не отправляем */
function isSendableChatId(id: string | null | undefined): id is string {
  return !!id && /^\d+$/.test(id);
}

export async function deliverTextToConversation(
  conversationId: string,
  text: string
): Promise<DeliverResult> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: { channel: true },
  });
  if (!conversation) return { delivered: false, error: 'conversation_not_found' };

  const { source } = conversation;
  const chatId = conversation.externalId;

  if (source === 'max') {
    const token = conversation.channel?.token;
    if (!token) return { delivered: false, error: 'no_channel_token' };
    if (!isSendableChatId(chatId)) return { delivered: false, error: 'no_chat_id' };
    const res = await maxSendMessage(token, chatId, text);
    if (!res.ok) {
      console.error('[deliver→max]', chatId, res.error);
      await db.channel
        .update({
          where: { id: conversation.channel!.id },
          data: { lastStatus: `Ошибка отправки: ${res.error}` },
        })
        .catch(() => {});
      return { delivered: false, error: res.error };
    }
    console.log(`[deliver→max] чат ${chatId}: ${text.slice(0, 60).replace(/\n/g, ' ')}`);
    return { delivered: true };
  }

  if (source === 'telegram') {
    const token = conversation.channel?.token;
    if (!token) return { delivered: false, error: 'no_channel_token' };
    if (!isSendableChatId(chatId)) return { delivered: false, error: 'no_chat_id' };
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const err = `Telegram HTTP ${res.status}`;
        console.error('[deliver→telegram]', chatId, err);
        return { delivered: false, error: err };
      }
      return { delivered: true };
    } catch (e) {
      const err = e instanceof Error ? e.message : 'telegram error';
      console.error('[deliver→telegram]', chatId, err);
      return { delivered: false, error: err };
    }
  }

  // web / simulator: клиент получает сообщения через polling — доставлено всегда
  return { delivered: true };
}

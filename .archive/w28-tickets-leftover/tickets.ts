import { db } from '@/lib/db';

/**
 * Заявка от клиента. Создаётся узлом «Заявка» в сценарии:
 * получает порядковый номер (виден клиенту), попадает в реестр
 * «Заявки» и в уведомительный блок оператора во «Входящих».
 */

export type TicketStatus = 'new' | 'in_progress' | 'done' | 'canceled';
export type TicketType = 'waste' | 'kgm' | 'complaint' | 'custom';

export const TICKET_START_NUMBER = 1001;

export const TICKET_TYPE_LABELS: Record<string, string> = {
  waste: 'Вывоз отходов',
  kgm: 'Вывоз КГМ',
  complaint: 'Жалоба',
  custom: 'Заявка',
};

export const TICKET_STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  done: 'Выполнена',
  canceled: 'Отменена',
};

export interface TicketDraft {
  botId: string;
  conversationId?: string | null;
  type: string;
  subject?: string;
  address?: string;
  scheduledAt?: string;
  phone?: string;
  details?: string;
}

export interface CreatedTicket {
  id: string;
  number: number;
}

/**
 * Создание заявки со сквозным номером в рамках бота.
 * Уникальность [botId, number]: при гонке двух одновременных заявок
 * проигравший пересчитывает номер и повторяет вставку.
 */
export async function createTicket(draft: TicketDraft): Promise<CreatedTicket> {
  const last = await db.ticket.findFirst({
    where: { botId: draft.botId },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const base = (last?.number ?? TICKET_START_NUMBER - 1) + 1;

  let attempt = 0;
  for (;;) {
    const number = base + attempt;
    try {
      const t = await db.ticket.create({
        data: {
          botId: draft.botId,
          conversationId: draft.conversationId ?? null,
          type: draft.type,
          subject: draft.subject ?? null,
          address: draft.address ?? null,
          scheduledAt: draft.scheduledAt ?? null,
          phone: draft.phone ?? null,
          details: draft.details ?? null,
          number,
        },
      });
      return { id: t.id, number: t.number };
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
      if (code === 'P2002' && attempt < 5) {
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

/** Уведомление оператора о заявке (показывается специальным блоком во «Входящих»). */
export function ticketNoticeText(type: string, number: number | null): string {
  const label = TICKET_TYPE_LABELS[type] ?? 'Заявка';
  return number
    ? `📋 Создана заявка №${number} (${label}) — оператор уведомлён`
    : `📋 ${label}: заявка передана оператору`;
}

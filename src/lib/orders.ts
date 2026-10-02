import { db } from '@/lib/db';

/**
 * Заявки клиентов (вывоз отходов / КГМ).
 * Создаются сценарием бота (узел «Сообщение» с флагом «Создать заявку»)
 * или вручную оператором в разделе «Заявки».
 */

export type OrderType = 'waste' | 'kgm' | 'other';

export const ORDER_STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  assigned: 'Назначена',
  in_progress: 'В работе',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

export const ORDER_TYPE_LABELS: Record<string, string> = {
  waste: 'Вывоз отходов',
  kgm: 'Вывоз КГМ',
  other: 'Другое',
};

export interface CreateOrderInput {
  botId: string;
  conversationId?: string | null;
  externalUserId?: string | null;
  type?: string;
  clientName?: string | null;
  phone?: string | null;
  address?: string | null;
  size?: string | null;
  wishDate?: string | null;
  comment?: string | null;
  status?: string;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Следующий номер заявки в пределах бота (№1, №2, …).
 * Ретраи на случай гонки двух одновременных заявок (unique botId+number).
 */
async function nextNumber(botId: string): Promise<number> {
  const agg = await db.order.aggregate({
    where: { botId },
    _max: { number: true },
  });
  return (agg._max.number ?? 0) + 1;
}

/**
 * Геокодинг адреса через Nominatim (OpenStreetMap) — бесплатные тайлы/поиск
 * без API-ключа, в одной экосистеме с OpenFreeMap. При недоступности сервиса
 * заявка сохраняется без координат — оператор укажет точку на карте вручную.
 */
export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const q = address.trim();
  if (!q) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ru&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BotStudio/1.0 (bot support orders)' },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { lat?: string; lon?: string }[];
    const first = data?.[0];
    const lat = parseFloat(first?.lat ?? '');
    const lng = parseFloat(first?.lon ?? '');
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return null;
  } catch {
    return null;
  }
}

/** Фоновая привязка координат к заявке (не блокирует ответ бота) */
function geocodeInBackground(orderId: string, address: string | null): void {
  if (!address || !address.trim()) return;
  void geocodeAddress(address)
    .then((geo) => {
      if (geo) {
        db.order
          .update({ where: { id: orderId }, data: { lat: geo.lat, lng: geo.lng } })
          .catch(() => {});
      }
    })
    .catch(() => {});
}

export async function createOrder(input: CreateOrderInput) {
  let order = null;
  // До 3 попыток: unique(botId, number) может нарушиться при гонке
  for (let attempt = 0; attempt < 3 && !order; attempt++) {
    try {
      order = await db.order.create({
        data: {
          botId: input.botId,
          conversationId: input.conversationId ?? null,
          externalUserId: input.externalUserId ?? null,
          number: await nextNumber(input.botId),
          type: input.type ?? 'waste',
          clientName: input.clientName ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
          size: input.size ?? null,
          wishDate: input.wishDate ?? null,
          comment: input.comment ?? null,
          status: input.status ?? 'new',
          lat: input.lat ?? null,
          lng: input.lng ?? null,
        },
      });
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
        continue;
      }
      throw e;
    }
  }
  if (!order) throw new Error('order_number_race');

  // Координаты по адресу — в фоне, чтобы не задерживать ответ бота
  if (input.lat == null && input.lng == null) {
    geocodeInBackground(order.id, input.address);
  }
  return order;
}

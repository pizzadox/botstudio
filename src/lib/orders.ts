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
  /// Как получены координаты: manual — указаны оператором, geocode — по адресу
  geoSource?: string | null;
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
 * без API-ключа, в одной экосистеме с OpenFreeMap.
 * Детерминированность: результаты кэшируются в памяти — повторный геокодинг
 * того же адреса всегда возвращает те же координаты (не «прыгают»).
 * Сначала ищем в России (countrycodes=ru — боты обслуживают РФ-адреса),
 * при пустом результате — повторяем без ограничения по стране.
 * При недоступности сервиса заявка сохраняется без координат — оператор
 * укажет точку на карте вручную.
 */

const geoCache = new Map<string, { lat: number; lng: number } | null>();

async function nominatimSearch(q: string, countrycodes?: string) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('accept-language', 'ru');
  if (countrycodes) url.searchParams.set('countrycodes', countrycodes);
  url.searchParams.set('q', q);
  const res = await fetch(url.toString(), {
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
}

export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const q = address.trim();
  if (!q) return null;

  const cacheKey = q.toLowerCase();
  if (geoCache.has(cacheKey)) return geoCache.get(cacheKey) ?? null;

  let result: { lat: number; lng: number } | null = null;
  try {
    // 1) приоритет — адреса в России; 2) fallback — весь мир
    result = await nominatimSearch(q, 'ru,ua,kz,by');
    if (!result) result = await nominatimSearch(q);
  } catch {
    result = null;
  }

  // Кэшируем и успех, и неудачу (неудача — короче, чтобы retry был возможен)
  if (geoCache.size > 500) geoCache.clear();
  geoCache.set(cacheKey, result);
  return result;
}

/** Фоновая привязка координат к заявке (не блокирует ответ бота) */
function geocodeInBackground(orderId: string, address: string | null): void {
  if (!address || !address.trim()) return;
  void geocodeAddress(address)
    .then((geo) => {
      if (geo) {
        db.order
          .update({
            where: { id: orderId },
            data: { lat: geo.lat, lng: geo.lng, geoSource: 'geocode' },
          })
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
          geoSource: input.geoSource ?? null,
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

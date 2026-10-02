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
  /// Город обслуживания (выбор города в боте / у оператора)
  city?: string | null;
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

const GEO_TTL_OK = 24 * 3600 * 1000; // успех — сутки (адреса не «прыгают»)
const GEO_TTL_FAIL = 60 * 1000; // неудача — минута (можно повторить)

const geoCache = new Map<string, { lat: number; lng: number; expiresAt: number } | { fail: true; expiresAt: number }>();

function cacheGet(key: string): { lat: number; lng: number } | null | undefined {
  const hit = geoCache.get(key);
  if (!hit) return undefined; // нет в кэше
  if (hit.expiresAt < Date.now()) {
    geoCache.delete(key);
    return undefined;
  }
  return 'fail' in hit ? null : { lat: hit.lat, lng: hit.lng };
}

function cachePut(key: string, result: { lat: number; lng: number } | null): void {
  if (geoCache.size > 500) geoCache.clear();
  geoCache.set(
    key,
    result
      ? { ...result, expiresAt: Date.now() + GEO_TTL_OK }
      : { fail: true, expiresAt: Date.now() + GEO_TTL_FAIL }
  );
}

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
  const data = (await res.json()) as { lat?: string; lon?: string; display_name?: string }[];
  const first = data?.[0];
  const lat = parseFloat(first?.lat ?? '');
  const lng = parseFloat(first?.lon ?? '');
  if (Number.isFinite(lat) && Number.isFinite(lng))
    return { lat, lng, display: first?.display_name ?? '' };
  return null;
}

export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const q = address.trim();
  if (!q) return null;

  const cacheKey = q.toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  let result: { lat: number; lng: number } | null = null;
  try {
    // 1) приоритет — адреса в России; 2) fallback — весь мир
    result = await nominatimSearch(q, 'ru,ua,kz,by');
    if (!result) result = await nominatimSearch(q);
  } catch {
    result = null;
  }

  cachePut(cacheKey, result);
  return result;
}

/**
 * Строгая проверка адреса (для автопроверки при вводе клиентом):
 * поиск только по России (без мирового fallback — он ловит мусорные совпадения),
 * при необходимости проверяем, что найденный объект действительно в нужном городе.
 * Кэш общий, но ключ отдельный (verify:).
 */
export async function geocodeVerify(
  address: string,
  mustInclude?: string
): Promise<boolean> {
  const q = address.trim();
  if (!q) return false;

  const cacheKey = `verify:${q.toLowerCase()}:${(mustInclude ?? '').toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached !== null;

  let hit: Awaited<ReturnType<typeof nominatimSearch>> = null;
  try {
    hit = await nominatimSearch(q, 'ru');
  } catch {
    hit = null;
  }

  let ok = false;
  if (hit) {
    const display = hit.display.toLowerCase();
    const need = (mustInclude ?? '').trim().toLowerCase();
    ok = !need || display.includes(need);
  }
  cachePut(cacheKey, ok && hit ? { lat: hit.lat, lng: hit.lng } : null);
  return ok;
}

/** Фоновая привязка координат к заявке (повторный попытка после сбоя) */
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

/**
 * Отложенная повторная попытка геокодинга: сбой при создании заявки
 * (сервис недоступен/таймаут) не должен оставлять заявку без точки навсегда.
 * Через 90 секунд сбрасываем кэш неудачи и пробуем снова.
 */
const geoRetryKeys = new Set<string>();
function geocodeRetryLater(orderId: string, address: string): void {
  const key = `${orderId}:${address.toLowerCase()}`;
  if (geoRetryKeys.has(key)) return; // повтор уже запланирован
  geoRetryKeys.add(key);
  setTimeout(() => {
    geoRetryKeys.delete(key);
    geoCache.delete(address.trim().toLowerCase());
    geocodeInBackground(orderId, address);
  }, 90 * 1000);
}

/**
 * Обратный геокодинг: координаты → адрес (Nominatim /reverse).
 * Используется, когда оператор ставит/сдвигает точку заявки вручную —
 * адрес в карточке подтягивается под точку на карте.
 * Кэш по округлённым координатам (5 знаков ≈ 1 м).
 */
const revCache = new Map<
  string,
  { address: string; city: string | null } | null
>();

export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<{ address: string; city: string | null } | null> {
  const key = `${lat.toFixed(5)}:${lng.toFixed(5)}`;
  if (revCache.has(key)) return revCache.get(key) ?? null;

  let result: { address: string; city: string | null } | null = null;
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('zoom', '18');
    url.searchParams.set('accept-language', 'ru');
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'BotStudio/1.0 (bot support orders)' },
      signal: AbortSignal.timeout(3500),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        address?: Record<string, string>;
        name?: string;
      };
      const a = json.address ?? {};
      const street = [a.road, a.house_number].filter(Boolean).join(', ');
      const city = a.city ?? a.town ?? a.village ?? a.municipality ?? null;
      const address = street || json.name || a.suburb || null;
      if (address) result = { address, city };
    }
  } catch {
    result = null;
  }

  if (revCache.size > 500) revCache.clear();
  revCache.set(key, result);
  return result;
}

export async function createOrder(input: CreateOrderInput) {
  // Координаты — сразу при создании (метка появляется на карте моментально):
  // геокодим до вставки, кэш делает результат детерминированным.
  let lat = input.lat ?? null;
  let lng = input.lng ?? null;
  let geoSource = input.geoSource ?? null;
  const fullAddress = input.address?.trim() ? input.address : null;
  let needsGeoRetry = false;
  if (lat == null && lng == null && fullAddress) {
    try {
      const geo = await geocodeAddress(fullAddress);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
        geoSource = 'geocode';
      } else {
        needsGeoRetry = true; // «не найдено» — попробуем позже
      }
    } catch {
      needsGeoRetry = true; // сбой сети/таймаут — попробуем позже
    }
  }

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
          city: input.city ?? null,
          address: input.address ?? null,
          size: input.size ?? null,
          wishDate: input.wishDate ?? null,
          comment: input.comment ?? null,
          status: input.status ?? 'new',
          lat,
          lng,
          geoSource,
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

  // Геокодинг не удался — отложенная повторная попытка для созданной заявки
  if (needsGeoRetry && lat == null && lng == null && fullAddress) {
    geocodeRetryLater(order.id, fullAddress);
  }
  return order;
}

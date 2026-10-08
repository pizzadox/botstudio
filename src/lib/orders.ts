import { db } from '@/lib/db';
import type { Order } from '@prisma/client';

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

const GEO_TTL_FAIL = 60 * 1000; // неудача — минута (можно повторить)
const GEO_CACHE_CAP = 500; // LRU: вытесняем самые старые ключи вместо полного clear()

type GeoHit = { lat: number; lng: number; display?: string } | null;

/** Кэш хранит ПРОМИСЫ: одинаковые адреса от разных запросов дедуплицируются
 *  в один полёт к Nominatim (политика сервиса — не дёргать её параллельно). */
const geoCache = new Map<string, Promise<GeoHit>>();

function lruTrim(map: Map<unknown, unknown>, cap: number): void {
  while (map.size > cap) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function cacheGeo(key: string, p: Promise<GeoHit>): Promise<GeoHit> {
  geoCache.delete(key); // обновляем позицию (LRU)
  geoCache.set(key, p);
  lruTrim(geoCache, GEO_CACHE_CAP);
  // «Не найдено»/сбой забываем через минуту (можно повторить), успех живёт до вытеснения
  const forget = () => {
    if (geoCache.get(key) === p) geoCache.delete(key);
  };
  const forgetLater = (): void => {
    const t = setTimeout(forget, GEO_TTL_FAIL);
    // таймер «забыть неудачный геокодинг» не должен удерживать процесс (IMP-BE21-25)
    if (typeof t.unref === 'function') t.unref();
  };
  void p.then(
    (hit) => {
      if (!hit) forgetLater();
    },
    forgetLater
  );
  return p;
}

// ─── Очередь Nominatim ≤ 1 запрос/сек (требование политики сервиса) ──────────
let lastNominatimAt = 0;
async function nominatimThrottle(): Promise<void> {
  const wait = lastNominatimAt + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimAt = Date.now();
}

async function nominatimSearch(
  q: string,
  countrycodes?: string,
  opts?: { viewbox?: string; bounded?: boolean }
) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('accept-language', 'ru');
  if (countrycodes) url.searchParams.set('countrycodes', countrycodes);
  // IMP-23-BE-06: локальный первый проход — прямоугольник Новгородской области
  // (29.6,57.9 — 35.6,59.3), bounded=1 — искать ТОЛЬКО внутри рамки
  if (opts?.viewbox) {
    url.searchParams.set('viewbox', opts.viewbox);
    if (opts.bounded) url.searchParams.set('bounded', '1');
  }
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

/** IMP-23-BE-06: рамка Новгородской области (левый-верхний, правый-нижний углы) */
const NOVGOROD_VIEWBOX = '29.6,59.3,35.6,57.9';

export async function geocodeAddress(
  address: string,
  opts?: { force?: boolean }
): Promise<{ lat: number; lng: number } | null> {
  const q = address.trim();
  if (!q) return null;

  const cacheKey = q.toLowerCase();
  // IMP-23-BE-06: force=true — игнорировать кэш (и успех, и неудачу):
  // «перепроверить адрес» оператором обязано сходить в сервис заново.
  // Новый результат всё равно записывается в кэш.
  if (!opts?.force) {
    const cached = geoCache.get(cacheKey);
    if (cached) {
      const hit = await cached;
      return hit ? { lat: hit.lat, lng: hit.lng } : null;
    }
  }

  const promise = (async (): Promise<GeoHit> => {
    try {
      // IMP-23-BE-06: 1) сначала — Новгородская область (viewbox bounded);
      // 2) приоритет — адреса в России (countrycodes=ru — боты обслуживают РФ-адреса);
      // 3) fallback — весь мир. Двухшаговая структура сохранена: локальный проход,
      // затем прежняя цепочка.
      await nominatimThrottle();
      let hit = await nominatimSearch(q, 'ru', { viewbox: NOVGOROD_VIEWBOX, bounded: true });
      if (!hit) {
        await nominatimThrottle();
        hit = await nominatimSearch(q, 'ru,ua,kz,by');
      }
      if (!hit) {
        await nominatimThrottle();
        hit = await nominatimSearch(q);
      }
      return hit ? { lat: hit.lat, lng: hit.lng } : null;
    } catch {
      return null;
    }
  })();

  cacheGeo(cacheKey, promise);
  const hit = await promise;
  return hit ? { lat: hit.lat, lng: hit.lng } : null;
}

/**
 * IMP-23-BE-06: сборка запроса для геокодинга ЗАЯВКИ — город обязательно
 * участвует в поиске (голая улица без города находится в неправильном регионе
 * или не находится вовсе — источник неверной точки заявки №7).
 * Если адрес уже начинается с города (в т.ч. «г. X» / «город X» —
 * регистр не важен) — город не дублируем.
 */
export function geocodeOrderAddress(
  city: string | null | undefined,
  address: string | null | undefined
): string {
  const c = (city ?? '').trim();
  const a = (address ?? '').trim();
  if (!c || !a) return a || c;
  const cl = c.toLowerCase();
  const al = a.toLowerCase();
  if (al.startsWith(cl)) return a;
  if (al.startsWith(`г. ${cl}`) || al.startsWith(`г.${cl}`) || al.startsWith(`город ${cl}`)) return a;
  return `${c}, ${a}`;
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
  const cached = geoCache.get(cacheKey);
  if (cached) {
    return (await cached) != null;
  }

  const promise = (async (): Promise<GeoHit> => {
    try {
      await nominatimThrottle();
      const hit = await nominatimSearch(q, 'ru');
      if (!hit) return null;
      const need = (mustInclude ?? '').trim().toLowerCase();
      const ok = !need || hit.display.toLowerCase().includes(need);
      return ok ? { lat: hit.lat, lng: hit.lng } : null;
    } catch {
      return null;
    }
  })();

  cacheGeo(cacheKey, promise);
  return (await promise) != null;
}

/** Фоновая привязка координат к заявке (повторный попытка после сбоя) */
function geocodeInBackground(orderId: string, query: string | null): void {
  if (!query || !query.trim()) return;
  void geocodeAddress(query)
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
function geocodeRetryLater(orderId: string, query: string): void {
  const key = `${orderId}:${query.toLowerCase()}`;
  if (geoRetryKeys.has(key)) return; // повтор уже запланирован
  geoRetryKeys.add(key);
  const t = setTimeout(() => {
    geoRetryKeys.delete(key);
    geoCache.delete(query.trim().toLowerCase());
    geocodeInBackground(orderId, query);
  }, 90 * 1000);
  // IMP-BE21-25: отложенный ретрай не должен удерживать процесс при завершении
  if (typeof t.unref === 'function') t.unref();
}

/**
 * Обратный геокодинг: координаты → адрес (Nominatim /reverse).
 * Используется, когда оператор ставит/сдвигает точку заявки вручную —
 * адрес в карточке подтягивается под точку на карте.
 * Кэш по округлённым координатам (5 знаков ≈ 1 м), хранит промисы (дедуп полётов),
 * LRU-очистка вместо полного clear().
 */
const REV_CACHE_CAP = 500;
const revCache = new Map<
  string,
  Promise<{ address: string; city: string | null } | null>
>();

export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<{ address: string; city: string | null } | null> {
  const key = `${lat.toFixed(5)}:${lng.toFixed(5)}`;
  const cached = revCache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<{ address: string; city: string | null } | null> => {
    try {
      await nominatimThrottle();
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
      if (!res.ok) return null;
      const json = (await res.json()) as {
        address?: Record<string, string>;
        name?: string;
      };
      const a = json.address ?? {};
      const street = [a.road, a.house_number].filter(Boolean).join(', ');
      // IMP-23-BE-07: город берём по цепочке city → town → village → municipality
      // и ЧИСТИМ префикс «городской/муниципальный округ» у ЛЮБОГО источника —
      // живые данные Nominatim для Великого Новгорода отдают мусорный префикс
      // именно в a.city («городской округ Великий Новгород»).
      const rawCity =
        (a.city ?? '').trim() ||
        (a.town ?? '').trim() ||
        (a.village ?? '').trim() ||
        (a.municipality ?? '').trim();
      const city = rawCity
        ? rawCity.replace(/^(городской|муниципальный) округ\s*/i, '').trim() || null
        : null;
      const address = street || json.name || a.suburb || null;
      return address ? { address, city } : null;
    } catch {
      return null;
    }
  })();

  revCache.delete(key); // LRU-позиция
  revCache.set(key, promise);
  lruTrim(revCache, REV_CACHE_CAP);
  return promise;
}

/**
 * BE22-19: телефон — только цифры и ведущий «+», длина ≤ 20.
 * «+7 (900) 123-45-67» → «+79001234567».
 */
function normalizePhone(input?: string | null): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const plus = raw.startsWith('+') ? '+' : '';
  const digits = raw.slice(plus.length).replace(/\D/g, '');
  const phone = (plus + digits).slice(0, 20);
  return phone || null;
}

export async function createOrder(input: CreateOrderInput) {
  // BE22-19: нормализация полей из сценария (бот собирает их из {{переменных}} —
  // длина/формат не гарантированы). Пределы согласованы с операторской формой
  // (см. POST /api/bots/[id]/orders); нормализация здесь защищает ВСЕХ вызывающих.
  const clientName = input.clientName?.trim().slice(0, 200) || null;
  const city = input.city?.trim().slice(0, 100) || null;
  const address = input.address?.trim().slice(0, 300) || null;
  const comment = input.comment?.trim().slice(0, 1000) || null;
  const wishDate = input.wishDate?.trim().slice(0, 30) || null;
  const phone = normalizePhone(input.phone);

  // Координаты — сразу при создании (метка появляется на карте моментально):
  // геокодим до вставки, кэш делает результат детерминированным.
  // IMP-23-BE-06: в запрос всегда подставляется город (geocodeOrderAddress) —
  // голая улица без города давала неверную точку (заявка №7).
  let lat = input.lat ?? null;
  let lng = input.lng ?? null;
  let geoSource = input.geoSource ?? null;
  const fullAddress = geocodeOrderAddress(city, address);
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

  let order: Order | null = null;
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
          clientName,
          phone,
          city,
          address,
          size: input.size ?? null,
          wishDate,
          comment,
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

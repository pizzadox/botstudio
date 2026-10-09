import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { areasCacheHit, parseMytkoConfig } from '@/lib/mytko'; // IMP-25-10: areasCacheHit
import { haversineM, getAreasIndexed, type AreaIndexEntry } from '@/lib/area-match'; // IMP-24-BE-07: сортировка по дистанции; IMP-25-10: индекс адресов

/**
 * IMP-23-BE-10: реестр КП (контейнерных площадок) бота — API для фронта.
 *
 * ?q=    — поиск по адресу ИЛИ коду КП (обе проверки — lowercase includes,
 *          регистр не важен, кириллица честно сравнивается в памяти —
 *          SQLite-коллация LOWER() не знает нелатиницу);
 * ?city= — подмножество адресов, содержащих город;
 * ?page= (1-based), ?take= (дефолт 50, максимум 500).
 *
 * IMP-24-BE-06/07: режимы карты (q/city/page в них игнорируются):
 * ?bbox=minLng,minLat,maxLng,maxLat[&sort=dist] — точки в рамке (IMP-25-17:
 * cap 2500; sort=dist — по дистанции до центра рамки, page:1);
 * ?near=lat,lng&radius=<м, def 300, cap 2000>&limit=<def 5, cap 20> —
 * ближайшие точки по haversine, в item добавляется distanceM.
 * Ответ во всех режимах — один контракт AreasResponse.
 *
 * lat/lng могут быть null — отдаются как есть. Сортировка address asc
 * (null последними), стабильный тайбрейк lkCode (уникален в пределах бота) —
 * пагинация детерминирована.
 * Если mytkoConfig отсутствует/не читается — пустой список с areasSyncedAt:null
 * (НЕ 404 — фронт показывает CTA «загрузить реестр»).
 */

type Params = { params: Promise<{ id: string }> };

const DEFAULT_TAKE = 50;
const MAX_TAKE = 500;

// IMP-24-BE-06/07: лимиты режимов карты
// IMP-25-17: cap поднят 1000 → 2500 — после кластеризации на фронте это
// безопасно, а крупные зумы раньше теряли часть КП за срезом
const BBOX_CAP = 2500;
const NEAR_DEFAULT_RADIUS = 300;
const NEAR_MAX_RADIUS = 2000;
const NEAR_DEFAULT_LIMIT = 5;
const NEAR_MAX_LIMIT = 20;

function noStore(body: Record<string, unknown>): NextResponse {
  const res = NextResponse.json(body);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

async function loadOwnedBot(req: NextRequest, botId: string) {
  const user = await getSessionUser(req);
  if (!user) return { error: 'unauthorized' as const };
  const bot = await db.bot.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== user.id) return { error: 'notfound' as const };
  return { user, bot };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const loaded = await loadOwnedBot(req, id);
  if ('error' in loaded) {
    return NextResponse.json(
      { error: loaded.error === 'unauthorized' ? 'Требуется авторизация' : 'Бот не найден' },
      { status: loaded.error === 'unauthorized' ? 401 : 404 }
    );
  }
  const { bot } = loaded;

  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') ?? '').trim();
  const city = (sp.get('city') ?? '').trim();
  const takeParam = Number(sp.get('take') ?? '');
  const take =
    Number.isFinite(takeParam) && takeParam > 0
      ? Math.min(Math.floor(takeParam), MAX_TAKE)
      : DEFAULT_TAKE;
  const pageParam = Number(sp.get('page') ?? '');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

  // areasSyncedAt — из mytkoConfig; конфиг не читается (нет/битый/нет APP_SECRET
  // для расшифровки пароля) — null, список всё равно отдаётся
  let areasSyncedAt: string | null = null;
  try {
    const cfg = parseMytkoConfig(bot.mytkoConfig);
    areasSyncedAt = cfg.areasSyncedAt || null;
  } catch {
    areasSyncedAt = null;
  }

  // IMP-25-10: реестр + индекс предвычисленных lowercase-адресов (см. area-match).
  // count() в БД нужен только на cache-miss (раз в TTL кэша) — при cache-hit
  // areasCount = areas.length (кэш построен из всех строк таблицы бота);
  // bbox/near-режимы карты больше не выполняют count() на каждый запрос.
  const cacheHit = areasCacheHit(bot.id); // ДО обращения — пока кэш ещё не мог заполниться
  const { areas, index } = await getAreasIndexed(bot.id); // кэш TTL 5 мин (та же инфраструктура, что у кодов КП)
  const areasCount = cacheHit ? areas.length : await db.mytkoArea.count({ where: { botId: bot.id } });

  // ── IMP-24-BE-07: режим near — ближайшие точки вокруг lat,lng ──────────────
  const nearParam = sp.get('near');
  if (nearParam) {
    const [latS, lngS] = nearParam.split(',').map((s) => s.trim());
    const lat = Number(latS);
    const lng = Number(lngS);
    if (!latS || !lngS || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: 'near — lat,lng (2 числа)' }, { status: 400 });
    }
    const radiusParam = Number(sp.get('radius') ?? '');
    const radius =
      Number.isFinite(radiusParam) && radiusParam > 0
        ? Math.min(radiusParam, NEAR_MAX_RADIUS)
        : NEAR_DEFAULT_RADIUS;
    const limitParam = Number(sp.get('limit') ?? '');
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(Math.floor(limitParam), NEAR_MAX_LIMIT)
        : NEAR_DEFAULT_LIMIT;

    const items = areas
      .filter((a) => a.lat != null && a.lng != null)
      .map((a) => ({ a, d: haversineM(lat, lng, a.lat as number, a.lng as number) }))
      .filter(({ d }) => d <= radius)
      .sort((x, y) => x.d - y.d)
      .slice(0, limit)
      .map(({ a, d }) => ({
        lkCode: a.lkCode,
        address: a.address,
        lat: a.lat,
        lng: a.lng,
        distanceM: Math.round(d),
      }));

    return noStore({
      items,
      total: items.length,
      page: 1,
      pages: 1,
      take: items.length,
      areasSyncedAt,
      areasCount,
    });
  }

  // ── IMP-24-BE-06: режим bbox — точки в рамке minLng,minLat,maxLng,maxLat ──
  // IMP-25-17: опция ?sort=dist — сортировка по дистанции до центра рамки
  // (haversine по кэшу, без запросов к БД; тайбрейк lkCode — детерминизм)
  const bboxParam = sp.get('bbox');
  if (bboxParam) {
    const nums = bboxParam.split(',').map((s) => Number(s.trim()));
    if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
      return NextResponse.json(
        { error: 'bbox — minLng,minLat,maxLng,maxLat (4 числа)' },
        { status: 400 }
      );
    }
    const [minLng, minLat, maxLng, maxLat] = nums;
    if (minLng > maxLng || minLat > maxLat) {
      return NextResponse.json(
        { error: 'bbox — требуется minLng ≤ maxLng и minLat ≤ maxLat' },
        { status: 400 }
      );
    }

    const inBox = areas.filter(
      (a) =>
        a.lat != null &&
        a.lng != null &&
        a.lat >= minLat &&
        a.lat <= maxLat &&
        a.lng >= minLng &&
        a.lng <= maxLng
    );
    const sortDist = sp.get('sort') === 'dist';
    let filtered = inBox;
    if (sortDist) {
      const cLat = (minLat + maxLat) / 2;
      const cLng = (minLng + maxLng) / 2;
      filtered = inBox
        .map((a) => ({ a, d: haversineM(cLat, cLng, a.lat as number, a.lng as number) }))
        .sort((x, y) => x.d - y.d || (x.a.lkCode < y.a.lkCode ? -1 : x.a.lkCode > y.a.lkCode ? 1 : 0))
        .map(({ a }) => a);
    } else {
      filtered = inBox.sort((x, y) => (x.lkCode < y.lkCode ? -1 : x.lkCode > y.lkCode ? 1 : 0));
    }
    const total = filtered.length;
    const items = filtered.slice(0, BBOX_CAP).map((a) => ({
      lkCode: a.lkCode,
      address: a.address,
      lat: a.lat,
      lng: a.lng,
    }));

    return noStore({
      items,
      total,
      page: 1,
      pages: 1,
      take: items.length,
      areasSyncedAt,
      areasCount,
    });
  }

  // Фильтры в памяти (см. шапку): q — адрес ИЛИ код; city — только адрес.
  // IMP-25-10: lowercase адресов предвычислен в индексе кэша — без
  // .toLowerCase() всех 11k адресов на каждый запрос.
  let list = areas;
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter((a) => {
      const entry: AreaIndexEntry | undefined = index.get(a.lkCode);
      const lower = entry ? entry.lower : (a.address ?? '').toLowerCase();
      return lower.includes(needle) || a.lkCode.toLowerCase().includes(needle);
    });
  }
  if (city) {
    const needle = city.toLowerCase();
    list = list.filter((a) => {
      const entry = index.get(a.lkCode);
      const lower = entry ? entry.lower : (a.address ?? '').toLowerCase();
      return lower.includes(needle);
    });
  }

  // Сортировка: address asc, null последними; тайбрейк lkCode — стабильная пагинация
  const byLk = (a: { lkCode: string }, b: { lkCode: string }) =>
    a.lkCode < b.lkCode ? -1 : a.lkCode > b.lkCode ? 1 : 0;
  list = [...list].sort((a, b) => {
    if (!a.address && !b.address) return byLk(a, b);
    if (!a.address) return 1;
    if (!b.address) return -1;
    const c = a.address.localeCompare(b.address, 'ru');
    return c !== 0 ? c : byLk(a, b);
  });

  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / take));
  const items = list.slice((page - 1) * take, page * take).map((a) => ({
    lkCode: a.lkCode,
    address: a.address,
    lat: a.lat,
    lng: a.lng,
  }));

  const res = noStore({
    items,
    total,
    page,
    pages,
    take,
    areasSyncedAt,
    areasCount,
  });
  return res;
}

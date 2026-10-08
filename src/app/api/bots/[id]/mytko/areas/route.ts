import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getAreasCached, parseMytkoConfig } from '@/lib/mytko';

/**
 * IMP-23-BE-10: реестр КП (контейнерных площадок) бота — API для фронта.
 *
 * ?q=    — поиск по адресу ИЛИ коду КП (обе проверки — lowercase includes,
 *          регистр не важен, кириллица честно сравнивается в памяти —
 *          SQLite-коллация LOWER() не знает нелатиницу);
 * ?city= — подмножество адресов, содержащих город;
 * ?page= (1-based), ?take= (дефолт 50, максимум 500).
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

  const [areas, areasCount] = await Promise.all([
    getAreasCached(bot.id), // кэш TTL 5 мин (та же инфраструктура, что у кодов КП)
    db.mytkoArea.count({ where: { botId: bot.id } }),
  ]);

  // Фильтры в памяти (см. шапку): q — адрес ИЛИ код; city — только адрес
  let list = areas;
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter(
      (a) =>
        (a.address ?? '').toLowerCase().includes(needle) ||
        a.lkCode.toLowerCase().includes(needle)
    );
  }
  if (city) {
    const needle = city.toLowerCase();
    list = list.filter((a) => (a.address ?? '').toLowerCase().includes(needle));
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

  const res = NextResponse.json({
    items,
    total,
    page,
    pages,
    take,
    areasSyncedAt,
    areasCount,
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

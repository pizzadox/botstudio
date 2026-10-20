// IMP-27-04: CSV-выгрузка реестра КП (бэклог волны 27)
//
// Эталон — orders/export/route.ts: тот же auth-паттерн, BOM, Content-Disposition,
// Cache-Control:no-store и честный X-Truncated. Отличия:
//  - rateLimit-бакет ОТДЕЛЬНЫЙ (areas-csv:) — экспорт заявок и КП в одну минуту
//    не блокируют друг друга;
//  - данные из кэша getAreasIndexed одним массивом (~11k строк) — курсорные
//    батчи НЕ нужны (это не DB-пагинация);
//  - фильтры q/city — копия list-ветки areas/route.ts;
//  - сортировка фиксирована: address asc (null последними), тайбрейк lkCode
//    asc — параметры sort/dir в экспорт v1 не принимаются (упрощение).

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { getAreasIndexed, type AreaIndexEntry } from '@/lib/area-match';
import { type MytkoArea } from '@/lib/mytko';
import { csvCell } from '@/lib/csv';

type Params = { params: Promise<{ id: string }> };

/** Колонки CSV — фикс. порядок. IMP-32-03: «Обновлено» — последняя колонка
 *  (дата синка строки из кэша; раньше её в select кэша не было). */
const HEADERS = ['Код КП', 'Адрес', 'Широта', 'Долгота', 'Обновлено'] as const;

// IMP-32-03: даты CSV — в Europe/Moscow (+3, без DST), а не в UTC сервера
// (паттерн эталона orders/export); формат ru «dd.MM.yyyy HH:mm» —
// Excel-дружелюбный и без запятой (csvCell не будет кавычить значение)
const MSK_DATETIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** IMP-32-03: дата «Обновлено» — «05.02.2026 14:03» (Europe/Moscow);
 *  null/не-Date → пустая строка (колонка пустая — дата в БД не проставлялась). */
function fmtDateRu(d: Date | null | undefined): string {
  if (!(d instanceof Date)) return '';
  const parts = MSK_DATETIME.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

// Кап выгрузки: реестр ~11k — 12000 покрывает его с запасом; всё сверх — усечение
const EXPORT_CAP = 12000;

/** CSV-выгрузка реестра КП бота. GET ?q=&city= → text/csv (UTF-8 + BOM для Excel). */
// IMP-29-B2: обёртка try/catch — сбой БД/кэша отдаёт JSON 500 вместо plain-text
export async function GET(req: NextRequest, ctx: Params) {
  try {
    return await areasExport(req, ctx);
  } catch (err) {
    console.error('[areas export]', err);
    return NextResponse.json({ error: 'Не удалось выгрузить CSV' }, { status: 500 });
  }
}

async function areasExport(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  // Выгрузка дорогая (сортировка 11k в памяти) — не больше 5 CSV с одного
  // пользователя в минуту (паттерн rateLimit эталона)
  if (!rateLimit(`areas-csv:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Слишком много запросов' }, { status: 429 });
  }

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  const sp = req.nextUrl.searchParams;

  // Фильтры — копия list-ветки areas/route.ts (q — адрес ИЛИ код; city — адрес);
  // lowercase адресов из предвычисленного индекса кэша (без 11k .toLowerCase())
  const q = (sp.get('q') ?? '').trim();
  const city = (sp.get('city') ?? '').trim();

  const { areas, index } = await getAreasIndexed(bot.id); // кэш TTL 5 мин, один массив
  let list: MytkoArea[] = areas;
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

  // Сортировка — дефолт реестра: address asc ru-локаль, null последними,
  // тайбрейк lkCode asc (детерминированный порядок строк файла)
  const byLk = (a: MytkoArea, b: MytkoArea) =>
    a.lkCode < b.lkCode ? -1 : a.lkCode > b.lkCode ? 1 : 0;
  list = [...list].sort((a, b) => {
    if (!a.address && !b.address) return byLk(a, b);
    if (!a.address) return 1;
    if (!b.address) return -1;
    const c = a.address.localeCompare(b.address, 'ru');
    return c !== 0 ? c : byLk(a, b);
  });

  // Кап 12000: ровно CAP строк — НЕ усечение (честный X-Truncated, как в эталоне)
  const truncated = list.length > EXPORT_CAP;
  if (truncated) list = list.slice(0, EXPORT_CAP);

  const rows: string[] = [HEADERS.map(csvCell).join(',')];
  for (const a of list) {
    // IMP-32-03: «Обновлено» — последняя колонка (после «Долгота»);
    // значение проходит общий csvCell (дата с точками без запятых — не кавычится,
    // но экранирование применено единообразно на всякий случай)
    rows.push(
      [a.lkCode, a.address, a.lat, a.lng, fmtDateRu(a.updatedAt)].map(csvCell).join(',')
    );
  }

  // BOM (\uFEFF) — чтобы Excel корректно открыл UTF-8 с кириллицей
  const csv = '\uFEFF' + rows.join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD

  const headers: Record<string, string> = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="kp-registry-${stamp}.csv"`,
    'Cache-Control': 'no-store',
  };
  if (truncated) headers['X-Truncated'] = '1';
  return new NextResponse(csv, { status: 200, headers });
}

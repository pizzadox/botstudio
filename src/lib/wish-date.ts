// IMP-24-BE-01: разбор желаемой даты подачи машины из свободного текста сценария
// («завтра до 12:00», «послезавтра», «через 3 дня», «в пятницу», «23.10», «23.10.2026»,
// «5 января после 15», «3 октября 2026», «через неделю/месяц» …).
//
// Календарный день считается в таймзоне Europe/Moscow (сервис обслуживает
// Новгородскую область): «сегодня» вычисляется через Intl.DateTimeFormat('en-CA')
// и НЕ зависит от таймзоны сервера. Итоговая date — полдень московского дня,
// записанный в UTC (Date.UTC(y, m-1, d, 9, 0, 0): 09:00 UTC = 12:00 MSK) — при
// отображении в Europe/Moscow календарный день всегда корректен.
//
// Человеческие уточнения времени («до 12:00», «после 15:00», «к 18:00»,
// «утром/днём/вечером») не парсятся в часы — они сохраняются в human.

export interface ParsedWishDate {
  /** Полдень московского календарного дня в UTC (null — дата не распознана) */
  date: Date | null;
  /** «23.10.2026, пятница, до 12:00»; если не распознано — исходный текст */
  human: string;
  matched: boolean;
}

/** Порядок дней как getUTCDay(): воскресенье = 0 */
const WEEKDAY_RU = [
  'воскресенье',
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
];

interface YMD {
  y: number;
  m: number;
  d: number;
}

// Границы слов: \b в JS не работает с кириллицей (\w — только ASCII),
// поэтому свои утверждения: не-буква/не-цифра слева (поглощается) и lookahead справа.
const L = '(?:^|[^\\p{L}\\p{N}])';
const R = '(?=$|[^\\p{L}\\p{N}])';

// ── Уточнения времени (в human; поиск по исходному тексту, чтобы сохранить «ё») ──
// «до 12:00» и «к 18:00» — только с двоеточием (иначе «до 23.10» спуталось бы с датой);
// «после 15:00» или «после 15» (без минут, но не «после 23.10» — lookahead отвергает точку).
const TIME_PART_RE = new RegExp(
  L +
    '(до\\s*\\d{1,2}:\\d{2}|после\\s*\\d{1,2}(?::\\d{2})?(?![.:])|к\\s*\\d{1,2}:\\d{2}|утром|днём|днем|вечером)' +
    R,
  'giu'
);

// ── Кандидаты даты (поиск по lowercased-тексту с ё→е) ──────────────────────────
const RE_AFTER_TOMORROW = new RegExp(L + '(послезавтра|после\\s+завтра)' + R, 'iu');
const RE_TOMORROW = new RegExp(L + 'завтра' + R, 'iu');
const RE_TODAY = new RegExp(L + 'сегодня' + R, 'iu');
const RE_IN_N_DAYS = new RegExp(L + 'через\\s+(\\d{1,3})\\s*(?:дн\\.?|день|дня|дней)' + R, 'iu');
// IMP-25-02: обороты «через сутки/неделю/месяц» и «через N недель/месяцев»
const RE_IN_UNITS = new RegExp(
  L +
    'через\\s+(?:(\\d{1,3})\\s*)?(сутки|суток|неделю|недели|недель|месяц|месяца|месяцев|месяцем)' +
    R,
  'iu'
);
const RE_WEEKDAY = new RegExp(
  L +
    '(?:в|во)?\\s*(понедельник(?:а|у)?|вторник(?:а|у)?|сред(?:а|у|е)|четверг(?:а|у)?|пятниц(?:а|у|е)|суббот(?:а|у|е)|воскресень(?:е|я|ю))' +
    R,
  'iu'
);
// «23.10.2026» (год обязателен; за годом не должно быть ещё цифр)
const RE_DMY = /(?:^|[^\p{L}\p{N}])(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/iu;
// «23.10» (без года; «23.10.» с точкой-знаком конца предложения тоже ок,
// но НЕ хвост «23.10.2026» — его забирает RE_DMY выше)
const RE_DM = /(?:^|[^\p{L}\p{N}.])(\d{1,2})\.(\d{1,2})(?!\.?\d)/iu;
// «23 октября», «5 января», «1 мая» … (+ IMP-25-02: опциональный ЯВНЫЙ год — «3 октября 2026»;
// без группы года явный год выбрасывался и срабатывало «прошлое → +1 год»)
const RE_DD_MONTH = new RegExp(
  L +
    '(\\d{1,2})\\s*(январ(?:ь|я|е)|феврал(?:ь|я|е)|март(?:а|у|е)|апрел(?:ь|я|е)|ма(?:й|я|е)|июн(?:ь|я|е)|июл(?:ь|я|е)|август(?:а|у|е)|сентябр(?:ь|я|е)|октябр(?:ь|я|е)|ноябр(?:ь|я|е)|декабр(?:ь|я|е))' +
    '(?:\\s+(\\d{4}))?' +
    R,
  'iu'
);

/** Сегодняшняя дата по календарю Europe/Moscow (независимо от TZ сервера) */
function moscowYMD(now: Date): YMD {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '', 10);
  return { y: get('year'), m: get('month'), d: get('day') };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function validYMD(y: number, m: number, d: number): boolean {
  return (
    Number.isFinite(y) &&
    Number.isFinite(m) &&
    Number.isFinite(d) &&
    y >= 1900 &&
    y <= 9999 &&
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    d <= daysInMonth(y, m)
  );
}

function addDaysYMD(base: YMD, n: number): YMD {
  const t = new Date(Date.UTC(base.y, base.m - 1, base.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** IMP-25-02: +N календарных месяцев (день зажимается к последнему дню месяца) */
function addMonthsYMD(base: YMD, n: number): YMD {
  const total = base.y * 12 + (base.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { y, m, d: Math.min(base.d, daysInMonth(y, m)) };
}

/** Полдень московского дня в UTC (09:00 UTC = 12:00 MSK) */
function ymdDate(t: YMD): Date {
  return new Date(Date.UTC(t.y, t.m - 1, t.d, 9, 0, 0));
}

/**
 * IMP-25-06: дефолт-время «дата без времени» — полдень московского дня в UTC
 * (09:00 UTC = 12:00 MSK), та же логика, что внутри parseWishDate (ymdDate).
 * null — дата невозможна (например 31 февраля); вызывающий код решает, как отдать ошибку.
 */
export function moscowNoonUTC(y: number, m: number, d: number): Date | null {
  if (!validYMD(y, m, d)) return null;
  return ymdDate({ y, m, d });
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Слово дня недели → getUTCDay()-нумерация (вс=0) */
function weekdayFromWord(w: string): number | null {
  if (w.startsWith('понедельн')) return 1;
  if (w.startsWith('вторник')) return 2;
  if (w.startsWith('сред')) return 3;
  if (w.startsWith('четверг')) return 4;
  if (w.startsWith('пятниц')) return 5;
  if (w.startsWith('суббот')) return 6;
  if (w.startsWith('воскресень')) return 0;
  return null;
}

/** Слово месяца → номер месяца (1..12) */
function monthFromWord(w: string): number | null {
  if (w.startsWith('январ')) return 1;
  if (w.startsWith('феврал')) return 2;
  if (w.startsWith('март')) return 3;
  if (w.startsWith('апрел')) return 4;
  if (w.startsWith('ма')) return 5;
  if (w.startsWith('июн')) return 6;
  if (w.startsWith('июл')) return 7;
  if (w.startsWith('август')) return 8;
  if (w.startsWith('сентябр')) return 9;
  if (w.startsWith('октябр')) return 10;
  if (w.startsWith('ноябр')) return 11;
  if (w.startsWith('декабр')) return 12;
  return null;
}

/** «…до 12:00 …вечером» → ['до 12:00', 'вечером'] (дубликаты схлопываются) */
function extractTimeParts(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(TIME_PART_RE)) {
    const part = (m[1] ?? '').trim();
    if (part) found.push(part);
  }
  return [...new Set(found)];
}

/**
 * Разобрать желаемую дату из свободного текста.
 * Регистронезависимо; «сегодня/завтра/послезавтра» и дни недели — относительно
 * СЕГОДНЯ в Europe/Moscow (день недели, совпадающий с сегодняшним, → сегодня);
 * «dd.mm» и «dd месяц» без года в прошлом → ближайший следующий год.
 */
export function parseWishDate(raw: string, now: Date = new Date()): ParsedWishDate {
  const text = (raw ?? '').trim();
  if (!text) return { date: null, human: '', matched: false };

  const lower = text.toLowerCase().replace(/ё/g, 'е');
  const timeParts = extractTimeParts(text);

  const today = moscowYMD(now);
  const todaySerial = today.y * 10000 + today.m * 100 + today.d;
  const todayDow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();

  let target: YMD | null = null;
  const rel = (n: number) => addDaysYMD(today, n);

  // Порядок важен: «послезавтра» раньше «завтра» (подстрока), точные — раньше общих
  if (RE_AFTER_TOMORROW.test(lower)) {
    target = rel(2);
  } else if (RE_TOMORROW.test(lower)) {
    target = rel(1);
  } else if (RE_TODAY.test(lower)) {
    target = rel(0);
  } else {
    const m = RE_IN_N_DAYS.exec(lower);
    if (m) {
      const n = parseInt(m[1] ?? '', 10);
      // разумный потолок — 10 лет; «через 99999 дней» датой не считается
      if (Number.isFinite(n) && n >= 0 && n <= 3650) target = rel(n);
    } else {
      // IMP-25-02: «через сутки/неделю/месяц», «через N недель/месяцев»
      const u = RE_IN_UNITS.exec(lower);
      if (u) {
        const n = u[1] ? parseInt(u[1], 10) : 1;
        const unit = u[2] ?? '';
        const ok = Number.isFinite(n) && n >= 0;
        if (ok && unit.startsWith('сутк') && n <= 3650) {
          target = rel(n); // «через сутки» = завтра (сутки = 1 день)
        } else if (ok && unit.startsWith('недел') && n <= 3650) {
          target = rel(n * 7);
        } else if (ok && unit.startsWith('месяц') && n <= 120) {
          target = addMonthsYMD(today, n); // календарный месяц, не 30 дней
        }
      }
    }
  }
  if (!target) {
    const m = RE_WEEKDAY.exec(lower);
    if (m) {
      const dow = weekdayFromWord(m[1] ?? '');
      // ближайший будущий день недели, включая сегодня
      if (dow != null) target = rel((dow - todayDow + 7) % 7);
    }
  }
  if (!target) {
    const m = RE_DMY.exec(lower);
    if (m) {
      const d = parseInt(m[1] ?? '', 10);
      const mo = parseInt(m[2] ?? '', 10);
      const y = parseInt(m[3] ?? '', 10);
      if (validYMD(y, mo, d)) target = { y, m: mo, d };
    }
  }
  if (!target) {
    const m = RE_DM.exec(lower);
    if (m) {
      const d = parseInt(m[1] ?? '', 10);
      const mo = parseInt(m[2] ?? '', 10);
      // без года: прошлое число этого года → ближайший следующий год
      const year = todaySerial > today.y * 10000 + mo * 100 + d ? today.y + 1 : today.y;
      // IMP-25-REV-3: «29 февраля» без года в невисокосный год — пробуем следующий год
      if (validYMD(year, mo, d)) target = { y: year, m: mo, d };
      else if (validYMD(year + 1, mo, d)) target = { y: year + 1, m: mo, d };
    }
  }
  if (!target) {
    const m = RE_DD_MONTH.exec(lower);
    if (m) {
      const d = parseInt(m[1] ?? '', 10);
      const mo = monthFromWord(m[2] ?? '');
      // IMP-25-02: явный год («3 октября 2026») — используем ЕГО, а не правило
      // «прошедшая дата без года → +1 год». Прежняя проверка validYMD(today.y, …)
      // до выбора года отбрасывала и валидные високосные дни чужого года
      // («29 февраля 2028» не распознавалась вовсе).
      if (mo != null) {
        const year =
          m[3] != null && m[3] !== ''
            ? parseInt(m[3], 10)
            : todaySerial > today.y * 10000 + mo * 100 + d
              ? today.y + 1
              : today.y;
        if (validYMD(year, mo, d)) target = { y: year, m: mo, d };
        // IMP-25-REV-3: «29 февраля» (без года) в невисокосный год → ближайший високосный
        else if ((m[3] == null || m[3] === '') && validYMD(year + 1, mo, d))
          target = { y: year + 1, m: mo, d };
      }
    }
  }

  if (!target) return { date: null, human: text, matched: false };

  const date = ymdDate(target);
  const human =
    `${pad2(target.d)}.${pad2(target.m)}.${target.y}, ${WEEKDAY_RU[date.getUTCDay()]}` +
    (timeParts.length ? `, ${timeParts.join(', ')}` : '');
  return { date, human, matched: true };
}

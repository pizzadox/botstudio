/**
 * Интеграция с MyTKO (mytko.ru — «Чистая логистика», платформа вывоза отходов).
 *
 * Официальная документация: https://docs.mytko.ru/docs/disp/API/
 *
 * Проверено живыми запросами (октябрь 2026), инстанс https://ecovn.mytko.ru:
 *  - У каждого проекта/города СВОЙ адрес API, схема путей одинаковая.
 *    Примеры: https://disp.t2.groupstp.ru (из документации),
 *    https://ecovn.mytko.ru (Великий Новгород) — оба отвечают по /app/api/v1/*.
 *  1. Авторизация: POST {apiUrl}/app/api/v1/authenticate { username, password }
 *     → { id_token }  ← именно поле id_token (не token!) — JWT, ~20 часов.
 *  2. Основной API данных — GraphQL на {apiUrl}/app/graphql (Bearer-токен).
 *     REST /app/api/v1/admin/task/getReportsForLk из документации доступен
 *     не всем ролям (например, REG_OPERATOR_ADMIN получает 403), а GraphQL
 *     запросы ниже работают под той же учёткой:
 *       - containerAreas(searchQuery: { page: { number, size } })
 *         → реестр ВСЕХ КП проекта: lkCode, address.view, geoData.center
 *         (ecovn: 10 952 КП по Новгородской области).
 *       - reportsFromDriverByAreaCodesAndPeriod(areaCodes, from, to)
 *         → отчёты водителей по кодам КП (Date = ISO с миллисекундами!).
 *       - currentEmployee → кто подключился (проверка доступа).
 *       - removalRequestFindPage → заявки на вывоз (чтение).
 *  3. Передача заявок (REMOVAL_REQUEST) и полная двусторонняя синхронизация —
 *     через Apache Kafka: топики EXTERNAL_SYNC_DSP_IMPORT_{server_name} /
 *     EXTERNAL_SYNC_DSP_EXPORT_{server_name} (доступ выдаёт mytko@groupstp.ru).
 */

import crypto from 'node:crypto';
import { db } from '@/lib/db';

// ─── Шифрование секретов в mytkoConfig (IMP-BE21-09) ─────────────────────────
//
// Пароль в bot.mytkoConfig раньше хранился plaintext. При СОХРАНЕНИИ он теперь
// шифруется AES-256-GCM ключом из APP_SECRET (sha256 от строки), префикс 'enc:v1:'.
// Чтение обратно совместимо: строка без префикса считается plaintext (старые записи).
// Если APP_SECRET не задан — сохраняем как раньше (plaintext), предупреждаем раз в процесс.

const ENC_PREFIX = 'enc:v1:';
let warnedNoSecret = false;

/** Ключ шифрования из APP_SECRET (32 байта через sha256) или null, если секрет не задан */
function secretKey(): Buffer | null {
  const secret = process.env.APP_SECRET?.trim();
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Зашифровать секрет для записи в mytkoConfig.
 * Без APP_SECRET возвращает plaintext как раньше (console.warn раз в процесс).
 */
export function encryptMytkoSecret(plain: string): string {
  const key = secretKey();
  if (!key) {
    if (!warnedNoSecret) {
      warnedNoSecret = true;
      console.warn(
        '[mytko] APP_SECRET не задан — пароль MyTKO сохраняется в БД без шифрования. ' +
          'Добавьте APP_SECRET=<hex> в .env.local и пересохраните пароль в настройках интеграции.'
      );
    }
    return plain;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [ENC_PREFIX + iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

/**
 * Расшифровать секрет из mytkoConfig. Строка без префикса 'enc:v1:' возвращается
 * как есть (обратная совместимость с plaintext-записями).
 * Ключ шифрования не совпал / APP_SECRET потерян — бросаем понятную ошибку.
 */
export function decryptMytkoSecret(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const key = secretKey();
  if (!key) {
    throw new Error(
      'Пароль MyTKO зашифрован (enc:v1), но APP_SECRET не задан. ' +
        'Добавьте APP_SECRET=<hex> в .env.local — тот же ключ, которым шифровали пароль.'
    );
  }
  const [ivB64, tagB64, dataB64] = stored.slice(ENC_PREFIX.length).split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Повреждена зашифрованная запись пароля MyTKO — введите пароль заново в настройках интеграции.');
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(
      'Не удалось расшифровать пароль MyTKO: APP_SECRET не совпадает с тем, которым шифровали пароль. ' +
        'Задайте прежний APP_SECRET или введите пароль заново в настройках интеграции.'
    );
  }
}

/**
 * Сериализация mytkoConfig для записи в БД: пароль шифруется (при заданном APP_SECRET).
 * Все записи конфига должны идти через неё — иначе пароль вернётся в БД plaintext'ом.
 */
export function serializeMytkoConfig(cfg: MytkoConfig): string {
  return JSON.stringify({ ...cfg, password: cfg.password ? encryptMytkoSecret(cfg.password) : '' });
}

// ─── Конфигурация ─────────────────────────────────────────────────────────────

/** Направления обмена данными с MyTKO (чекбоксы в настройках интеграции) */
export interface MytkoDirections {
  /** Получаем: реестр КП — все контейнерные площадки проекта (коды, адреса, координаты) */
  areas: boolean;
  /** Получаем: отчёты водителей — факты вывоза по КП */
  driverReports: boolean;
  /** Получаем: заявки на вывоз из MyTKO (чтение removalRequestFindPage) */
  requests: boolean;
  /** Отправляем: заявки на вывоз в MyTKO (REMOVAL_REQUEST, через Kafka) */
  sendRequests: boolean;
}

export const DEFAULT_MYTKO_DIRECTIONS: MytkoDirections = {
  areas: true,
  driverReports: true,
  requests: false,
  sendRequests: false,
};

export interface MytkoConfig {
  enabled: boolean;
  /** Адрес API проекта, например https://ecovn.mytko.ru (схема путей у всех одинаковая) */
  apiUrl?: string;
  username?: string;
  password?: string;
  /** Коды КП (лицевые коды контейнерных площадок), через запятую — ручной режим */
  lkCodes?: string;
  /** Использовать ВСЕ возможные КП из реестра MyTKO (таблица MytkoArea) */
  useAllAreas?: boolean;
  /** Направления обмена (чекбоксы) */
  directions?: MytkoDirections;
  /** Сохранённый Bearer-токен (получен кнопкой «Войти и получить токен») */
  token?: string;
  /** Когда получен токен (ISO) */
  tokenIssuedAt?: string;
  /** Когда последний раз загружался реестр КП (ISO) */
  areasSyncedAt?: string;
}

export function parseMytkoConfig(raw: string | null | undefined): MytkoConfig {
  const empty = { enabled: false, apiUrl: '', username: '', password: '', lkCodes: '', useAllAreas: false, token: '', tokenIssuedAt: '', areasSyncedAt: '' };
  let parsed: Record<string, unknown>;
  try {
    parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return { ...empty, directions: { ...DEFAULT_MYTKO_DIRECTIONS } };
  }
  const d = (parsed.directions ?? {}) as Record<string, unknown>;
  const storedPassword = typeof parsed.password === 'string' ? parsed.password : '';
  return {
    enabled: parsed.enabled === true,
    apiUrl: typeof parsed.apiUrl === 'string' ? parsed.apiUrl : '',
    username: typeof parsed.username === 'string' ? parsed.username : '',
    // Пароль может быть зашифрован ('enc:v1:...') — расшифровываем при чтении;
    // plaintext (старые записи) возвращается как есть. Ошибка расшифровки
    // (потерян APP_SECRET) пробрасывается наружу с понятным текстом.
    password: storedPassword ? decryptMytkoSecret(storedPassword) : '',
    lkCodes: typeof parsed.lkCodes === 'string' ? parsed.lkCodes : '',
    useAllAreas: parsed.useAllAreas === true,
    directions: {
      areas: d.areas !== false, // по умолчанию включено
      driverReports: d.driverReports !== false,
      requests: d.requests === true,
      sendRequests: d.sendRequests === true,
    },
    token: typeof parsed.token === 'string' ? parsed.token : '',
    tokenIssuedAt: typeof parsed.tokenIssuedAt === 'string' ? parsed.tokenIssuedAt : '',
    areasSyncedAt: typeof parsed.areasSyncedAt === 'string' ? parsed.areasSyncedAt : '',
  };
}

/**
 * Нормализация адреса API: «ecovn.mytko.ru», «https://ecovn.mytko.ru/»,
 * «https://ecovn.mytko.ru/app» → «https://ecovn.mytko.ru».
 */
export function normalizeApiUrl(input?: string): string {
  let v = (input ?? '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  v = v.replace(/\/+$/, '');
  v = v.replace(/\/app$/i, '');
  return v;
}

/** Маска токена для показа в UI: первые и последние символы */
export function maskToken(token: string | null | undefined): string | null {
  const t = (token ?? '').trim();
  if (!t) return null;
  if (t.length <= 12) return `${t.slice(0, 3)}…`;
  return `${t.slice(0, 8)}…${t.slice(-4)}`;
}

// ─── Авторизация (токен кэшируется в памяти на 20 часов) ─────────────────────

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

export async function mytkoAuthenticate(
  cfg: MytkoConfig,
  opts?: { force?: boolean }
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const base = normalizeApiUrl(cfg.apiUrl);
  const key = `${base}|${cfg.username ?? ''}`;

  // 1) Кэш в памяти
  if (!opts?.force) {
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return { ok: true, token: cached.token };
    // 2) Сохранённый в БД токен (кнопка «Войти и получить токен»)
    if (cfg.token) return { ok: true, token: cfg.token };
  }

  if (!base || !cfg.username || !cfg.password) {
    return {
      ok: false,
      error: 'Заполните адрес API (например ecovn.mytko.ru), логин и пароль MyTKO',
    };
  }

  try {
    const res = await fetch(`${base}/app/api/v1/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cfg.username, password: cfg.password }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      if (res.status === 401) {
        return { ok: false, error: 'Неверный логин или пароль MyTKO (401)' };
      }
      return { ok: false, error: `MyTKO HTTP ${res.status}` };
    }
    const json = (await res.json()) as Record<string, unknown> | string;
    // ВАЖНО: MyTKO возвращает токен в поле id_token (проверено на ecovn.mytko.ru)
    const token =
      typeof json === 'string'
        ? json
        : ((json.id_token as string) ??
          (json.token as string) ??
          (json.access_token as string));
    if (!token) return { ok: false, error: 'MyTKO не вернул токен' };
    tokenCache.set(key, { token, expiresAt: Date.now() + 20 * 3600 * 1000 });
    return { ok: true, token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'ошибка сети' };
  }
}

// ─── GraphQL-клиент (/app/graphql) ────────────────────────────────────────────

async function mytkoGraphQL<T>(
  cfg: MytkoConfig,
  query: string,
  variables?: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const base = normalizeApiUrl(cfg.apiUrl);
  if (!base) return { ok: false, error: 'Не указан адрес API MyTKO' };

  let auth = await mytkoAuthenticate(cfg);
  if (!auth.ok) return auth;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${base}/app/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ query, variables }),
        // MyTKO сам ограничивает запрос 30 с — 90 с были избыточны (IMP-BE21-08а)
        signal: AbortSignal.timeout(35_000),
      });
      // Токен протух — получаем новый и повторяем один раз
      if (res.status === 401 && attempt === 0) {
        auth = await mytkoAuthenticate(cfg, { force: true });
        if (!auth.ok) return auth;
        continue;
      }
      if (!res.ok) return { ok: false, error: `MyTKO HTTP ${res.status}` };
      const json = (await res.json()) as {
        data?: T;
        errors?: Array<{ message?: string; extensions?: { code?: number | string } | null }>;
      };
      if (json.errors?.length) {
        // ВАЖНО: на невалидный/протухший токен MyTKO отвечает HTTP 200 с
        // GraphQL-ошибкой { message: "Access is denied", extensions: { code: 401 } }
        // (проверено на ecovn.mytko.ru). Реавторизуемся и повторяем один раз —
        // иначе пользователь видит «Ошибка: Access is denied».
        const authError =
          json.errors.some((e) => e.extensions?.code === 401 || e.extensions?.code === '401') ||
          json.errors.some((e) => /access (is )?denied/i.test(e.message ?? ''));
        if (authError && attempt === 0) {
          auth = await mytkoAuthenticate(cfg, { force: true });
          if (!auth.ok) {
            return {
              ok: false,
              error: `Токен MyTKO истёк, повторный вход не удался: ${auth.error}`,
            };
          }
          continue;
        }
        return { ok: false, error: json.errors.map((e) => e.message ?? 'ошибка').join('; ').slice(0, 300) };
      }
      if (!json.data) return { ok: false, error: 'MyTKO вернул пустой ответ' };
      return { ok: true, data: json.data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'ошибка сети' };
    }
  }
  return { ok: false, error: 'MyTKO: не удалось выполнить запрос' };
}

/**
 * Свежий токен из кэша авторизации (после авто-реавторизации в mytkoGraphQL).
 * Роуты используют его, чтобы перезаписать протухший токен в bot.mytkoConfig —
 * иначе после перезапуска сервера каждый первый запрос снова идёт с протухшим токеном.
 */
export function getFreshToken(apiUrl: string | undefined, username?: string): string | null {
  const key = `${normalizeApiUrl(apiUrl)}|${username ?? ''}`;
  const cached = tokenCache.get(key);
  return cached && cached.expiresAt > Date.now() ? cached.token : null;
}

/** Кто подключен — для проверки доступа (роль/регионы) */
export async function mytkoWhoAmI(
  cfg: MytkoConfig
): Promise<{ ok: true; name: string; regions: string[] } | { ok: false; error: string }> {
  const q = `{ currentEmployee { id person { fullName } regions { name } } }`;
  const res = await mytkoGraphQL<{ currentEmployee: { person?: { fullName?: string | null } | null; regions?: Array<{ name?: string | null } | null> | null } | null }>(cfg, q);
  if (!res.ok) return res;
  const emp = res.data.currentEmployee;
  if (!emp) return { ok: false, error: 'MyTKO не вернул данные сотрудника' };
  return {
    ok: true,
    name: emp.person?.fullName ?? cfg.username ?? '',
    regions: (emp.regions ?? []).map((r) => r?.name ?? '').filter(Boolean),
  };
}

// ─── Кэш кодов КП (реестр ~11k строк — не читаем из БД на каждую сверку) ──────

const areaCodeGlobals = globalThis as unknown as {
  __mytkoAreaCodeCache?: Map<string, { codes: string[]; expiresAt: number }>;
  __mytkoAreasCache?: Map<string, { areas: MytkoArea[]; expiresAt: number }>;
};
const AREA_CODES_TTL = 5 * 60 * 1000; // 5 минут

/** Коды КП бота из реестра (MytkoArea), кэшируются на 5 минут.
 *  Инвалидация — после успешной синхронизации реестра (sync-areas). */
export async function getAreaCodesCached(botId: string): Promise<string[]> {
  const cache = (areaCodeGlobals.__mytkoAreaCodeCache ??= new Map());
  const hit = cache.get(botId);
  if (hit && hit.expiresAt > Date.now()) return hit.codes;
  const areas = await db.mytkoArea.findMany({
    where: { botId },
    select: { lkCode: true },
  });
  const codes = areas.map((a) => a.lkCode);
  cache.set(botId, { codes, expiresAt: Date.now() + AREA_CODES_TTL });
  return codes;
}

/** Полный реестр КП бота (lkCode + адрес + координаты), кэш TTL 5 минут —
 *  та же инфраструктура, что у getAreaCodesCached. Нужен для префильтра
 *  кодов отчётов по городу (IMP-BE21-08б), чтобы не слать ~11k кодов в MyTKO,
 *  когда боту интересен один город. */
export async function getAreasCached(botId: string): Promise<MytkoArea[]> {
  const cache = (areaCodeGlobals.__mytkoAreasCache ??= new Map());
  const hit = cache.get(botId);
  if (hit && hit.expiresAt > Date.now()) return hit.areas;
  const rows = await db.mytkoArea.findMany({
    where: { botId },
    select: { lkCode: true, address: true, lat: true, lng: true },
  });
  const areas: MytkoArea[] = rows.map((a) => ({
    lkCode: a.lkCode,
    address: a.address,
    lat: a.lat,
    lng: a.lng,
  }));
  cache.set(botId, { areas, expiresAt: Date.now() + AREA_CODES_TTL });
  return areas;
}

/** Сбросить кэши реестра КП бота (после sync-areas / изменения реестра).
 *  Сигнатура прежняя — сбрасываются и коды, и полный реестр. */
export function invalidateAreaCodesCache(botId: string): void {
  (areaCodeGlobals.__mytkoAreaCodeCache ??= new Map()).delete(botId);
  (areaCodeGlobals.__mytkoAreasCache ??= new Map()).delete(botId);
}

// ─── Реестр КП: все возможные коды контейнерных площадок ─────────────────────

export interface MytkoArea {
  lkCode: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

const CONTAINER_AREAS_QUERY = `
query($q: SearchQuery!) {
  containerAreas(searchQuery: $q) {
    page { number size totalElements }
    content {
      id
      lkCode
      address { view }
      geoData { center { latitude longitude } }
    }
  }
}`;

/**
 * Полный реестр КП проекта (все возможные КОДЫ КП).
 * Сервер ограничивает запрос 30 секундами, поэтому идём страницами по 2000.
 */
export async function mytkoFetchAllAreas(
  cfg: MytkoConfig,
  opts?: { pageSize?: number; onPage?: (loaded: number, total: number) => void }
): Promise<{ ok: true; areas: MytkoArea[] } | { ok: false; error: string }> {
  const pageSize = opts?.pageSize ?? 2000;
  const areas: MytkoArea[] = [];
  let number = 0;
  let total = Infinity;

  while (areas.length < total && number < 50) {
    const res = await mytkoGraphQL<{
      containerAreas: {
        page: { number: number; size: number; totalElements: number };
        content: Array<{
          lkCode?: string | null;
          address?: { view?: string | null } | null;
          geoData?: { center?: { latitude?: number | null; longitude?: number | null } | null } | null;
        } | null>;
      } | null;
    }>(cfg, CONTAINER_AREAS_QUERY, { q: { page: { number, size: pageSize } } });
    if (!res.ok) return res;

    const page = res.data.containerAreas;
    if (!page) return { ok: false, error: 'MyTKO не вернул страницу реестра КП' };
    total = page.page.totalElements ?? areas.length;
    for (const a of page.content ?? []) {
      if (!a?.lkCode) continue;
      areas.push({
        lkCode: a.lkCode,
        address: a.address?.view ?? null,
        lat: a.geoData?.center?.latitude ?? null,
        lng: a.geoData?.center?.longitude ?? null,
      });
    }
    opts?.onPage?.(areas.length, total);
    const size = page.page.size ?? pageSize;
    if ((page.content ?? []).length < size) break; // последняя страница
    number += 1;
  }

  // Дедупликация по lkCode
  const map = new Map<string, MytkoArea>();
  for (const a of areas) map.set(a.lkCode, a);
  return { ok: true, areas: [...map.values()] };
}

// ─── Отчёты водителей (факт вывоза по КП) — GraphQL ───────────────────────────

export interface MytkoDriverReport {
  id: string;
  /** Дата и время вывоза */
  removalTs: string | null;
  /** Номер транспортного средства (машина, назначенная/выполнявшая вывоз) */
  vehicleNumber: string | null;
  /** Код контейнерной площадки */
  lkCode: string | null;
  /** Название/адрес площадки, если отдан сервером */
  areaName: string | null;
  /** Фактическое количество вывезенных контейнеров */
  factContainersAmount: number | null;
  /** Собранный объём, м³ */
  pickedUpVolume: number | null;
  /** Не вывезенные контейнеры */
  notRemoved: number;
}

const REPORTS_QUERY = `
query($areaCodes: [String!]!, $from: Date, $to: Date) {
  reportsFromDriverByAreaCodesAndPeriod(areaCodes: $areaCodes, from: $from, to: $to) {
    area { lkCode address { view } }
    reports {
      id
      removalDate
      containersAmountFact
      containersAmountPickedUp
      containersAmountPlan
      vehicle { number { full } }
    }
  }
}`;

/**
 * Отчёты водителей за период по списку кодов КП.
 * areaCodes — коды КП из реестра (см. mytkoFetchAllAreas) или ручного списка.
 * Сервер ограничивает время выполнения 30 сек, поэтому запросы идут чанками.
 */
export async function mytkoGetDriverReports(
  cfg: MytkoConfig,
  opts?: { areaCodes?: string[]; fromIso?: string; toIso?: string }
): Promise<{ ok: true; reports: MytkoDriverReport[] } | { ok: false; error: string }> {
  const to = opts?.toIso ?? new Date().toISOString();
  const from = opts?.fromIso ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const codes = opts?.areaCodes ?? [];

  if (codes.length === 0) return { ok: true, reports: [] };

  const CHUNK = 800;
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += CHUNK) chunks.push(codes.slice(i, i + CHUNK));

  const fetchChunk = async (
    chunk: string[]
  ): Promise<{ ok: true; reports: MytkoDriverReport[] } | { ok: false; error: string }> => {
    const res = await mytkoGraphQL<{
      reportsFromDriverByAreaCodesAndPeriod: Array<{
        area?: { lkCode?: string | null; address?: { view?: string | null } | null } | null;
        reports?: Array<{
          id?: string | null;
          removalDate?: string | null;
          containersAmountFact?: number | null;
          containersAmountPickedUp?: number | null;
          vehicle?: { number?: { full?: string | null } | null } | null;
        } | null> | null;
      } | null> | null;
    }>(cfg, REPORTS_QUERY, { areaCodes: chunk, from, to });
    if (!res.ok) return res;

    const out: MytkoDriverReport[] = [];
    for (const item of res.data.reportsFromDriverByAreaCodesAndPeriod ?? []) {
      const lkCode = item?.area?.lkCode ?? null;
      const areaName = item?.area?.address?.view ?? null;
      for (const r of item?.reports ?? []) {
        if (!r?.id) continue;
        out.push({
          id: r.id,
          removalTs: r.removalDate ?? null,
          vehicleNumber: r.vehicle?.number?.full ?? null,
          lkCode,
          areaName,
          factContainersAmount: r.containersAmountFact ?? null,
          pickedUpVolume: r.containersAmountPickedUp ?? null,
          notRemoved: 0,
        });
      }
    }
    return { ok: true, reports: out };
  };

  // IMP-BE21-08а: раньше чанки шли строго последовательно (~14 запросов).
  // Теперь — параллельно с concurrency 3: группы по 3, Promise.all,
  // группы последовательно (не DDoS-им MyTKO). ~5 волн вместо 14 ожиданий.
  const CONCURRENCY = 3;
  const reports: MytkoDriverReport[] = [];
  for (let gi = 0; gi < chunks.length; gi += CONCURRENCY) {
    const group = chunks.slice(gi, gi + CONCURRENCY);
    const results = await Promise.all(group.map((chunk) => fetchChunk(chunk)));
    for (const r of results) {
      if (!r.ok) return r;
      reports.push(...r.reports);
    }
  }

  reports.sort((a, b) => (b.removalTs ?? '').localeCompare(a.removalTs ?? ''));
  return { ok: true, reports };
}

// ─── Синхронизация заявки с MyTKO ────────────────────────────────────────────
//
// Заявки на вывоз (REMOVAL_REQUEST) по документации передаются в ЧЛ через Kafka
// (доступ выдаёт поддержка). Пока доступ к Kafka не выдан, «синхронизация»
// заявки — это сверка с MyTKO по REST/GraphQL: проверяем токен (логин/пароль),
// получаем отчёты водителей за период заявки по ВСЕМ возможным КП и ищем факт
// вывоза по адресу/КП. Найден факт → статус synced + сводка (машина, дата);
// нет факта — synced «вывоз не подтверждён»; связь/доступы не работают → error.

export interface MytkoOrderSyncResult {
  ok: boolean;
  status: 'synced' | 'error';
  info: string | null;
  error: string | null;
}

function normText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,;:«»"'()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ищем факт вывоза, совпадающий с адресом/городом заявки */
function matchReport(
  order: { city?: string | null; address?: string | null },
  reports: MytkoDriverReport[]
): MytkoDriverReport | null {
  const addr = normText(`${order.city ?? ''} ${order.address ?? ''}`);
  if (!addr) return null;
  const words = addr.split(' ').filter((w) => w.length >= 4);
  for (const r of reports) {
    const hay = normText(`${r.areaName ?? ''} ${r.lkCode ?? ''}`);
    if (!hay) continue;
    if (words.some((w) => hay.includes(w))) return r;
  }
  return null;
}

export async function mytkoSyncOrder(
  cfg: MytkoConfig,
  order: { city: string | null; address: string | null; createdAt: Date },
  areaCodes: string[]
): Promise<MytkoOrderSyncResult> {
  const fromIso = new Date(order.createdAt.getTime() - 24 * 3600 * 1000).toISOString();
  const res = await mytkoGetDriverReports(cfg, { fromIso, areaCodes });
  if (!res.ok) return { ok: false, status: 'error', info: null, error: res.error };

  const matched = matchReport(order, res.reports);
  if (matched) {
    const when = matched.removalTs
      ? new Date(matched.removalTs).toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'дата неизвестна';
    return {
      ok: true,
      status: 'synced',
      info: `Факт вывоза: ${matched.vehicleNumber ?? 'машина не указана'}, ${when}`,
      error: null,
    };
  }
  return {
    ok: true,
    status: 'synced',
    info: 'MyTKO доступен, факт вывоза по адресу пока не найден',
    error: null,
  };
}

// ─── Передача заявки (REMOVAL_REQUEST) — заготовка под Kafka ─────────────────
//
// Когда появятся доступы (топик EXTERNAL_SYNC_DSP_IMPORT_{server_name}),
// здесь добавляется producer (kafkajs) или HTTP-bridge.
export interface MytkoRemovalRequest {
  id: string;
  address: string;
  comment?: string | null;
  wasteType: 'TKO' | 'KGM';
  desiredDate?: string | null;
  phone?: string | null;
}

export function buildRemovalRequestMessage(order: MytkoRemovalRequest): string {
  return JSON.stringify({
    entityType: 'REMOVAL_REQUEST',
    status: 'ACTIVE',
    id: order.id,
    address: order.address,
    comment: order.comment ?? null,
    wasteType: order.wasteType,
    desiredDate: order.desiredDate ?? null,
    phone: order.phone ?? null,
  });
}

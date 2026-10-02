/**
 * Интеграция с MyTKO (mytko.ru — «Чистая логистика», платформа вывоза отходов).
 *
 * Официальная документация: https://docs.mytko.ru/docs/disp/API/
 *
 * Проверено живым запросом (октябрь 2026):
 *  - У каждого проекта/города СВОЙ адрес API, схема путей одинаковая.
 *    Примеры: https://disp.t2.groupstp.ru (из документации),
 *    https://ecovn.mytko.ru (Великий Новгород) — оба отвечают по /app/api/v1/*.
 *  1. REST API с Bearer-авторизацией:
 *     POST {apiUrl}/app/api/v1/authenticate  { username, password } → { token }
 *  2. Отчёты водителей (назначенные машины и факт вывоза):
 *     GET {apiUrl}/app/api/v1/admin/task/getReportsForLk
 *         ?dateAppTzFrom=...&dateAppTzTo=...&lkCodes=38012345,38105858
 *     → [{ vehicleNumber, removalTs, factContainersAmount, pickedUpVolume, area:{lkCode}, photos }]
 *  3. Передача заявок (REMOVAL_REQUEST) и полная синхронизация — через Apache Kafka:
 *     импорт в ЧЛ: топик EXTERNAL_SYNC_DSP_IMPORT_{server_name}
 *     экспорт из ЧЛ: топик EXTERNAL_SYNC_DSP_EXPORT_{server_name}
 *     (доступ выдаётся техподдержкой mytko@groupstp.ru под конкретную интеграцию)
 */

export interface MytkoConfig {
  enabled: boolean;
  /** Адрес API проекта, например https://ecovn.mytko.ru (схема путей у всех одинаковая) */
  apiUrl?: string;
  username?: string;
  password?: string;
  /** Коды КП (лицевые коды контейнерных площадок), через запятую */
  lkCodes?: string;
  /** Сохранённый Bearer-токен (получен кнопкой «Войти и получить токен») */
  token?: string;
  /** Когда получен токен (ISO) */
  tokenIssuedAt?: string;
}

export function parseMytkoConfig(raw: string | null | undefined): MytkoConfig {
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      enabled: parsed.enabled === true,
      apiUrl: typeof parsed.apiUrl === 'string' ? parsed.apiUrl : '',
      username: typeof parsed.username === 'string' ? parsed.username : '',
      password: typeof parsed.password === 'string' ? parsed.password : '',
      lkCodes: typeof parsed.lkCodes === 'string' ? parsed.lkCodes : '',
      token: typeof parsed.token === 'string' ? parsed.token : '',
      tokenIssuedAt: typeof parsed.tokenIssuedAt === 'string' ? parsed.tokenIssuedAt : '',
    };
  } catch {
    return { enabled: false, apiUrl: '', username: '', password: '', lkCodes: '', token: '', tokenIssuedAt: '' };
  }
}

/**
 * Нормализация адреса API: «ecovn.mytko.ru», «https://ecovn.mytko.ru/»,
 * «https://ecovn.mytko.ru/app» → «https://ecovn.mytko.ru».
 */
export function normalizeApiUrl(input: string): string {
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
    const json = (await res.json()) as { token?: string } | string;
    const token =
      typeof json === 'string' ? json : (json.token ?? (json as { access_token?: string }).access_token);
    if (!token) return { ok: false, error: 'MyTKO не вернул токен' };
    tokenCache.set(key, { token, expiresAt: Date.now() + 20 * 3600 * 1000 });
    return { ok: true, token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'ошибка сети' };
  }
}

/** Универсальный GET к MyTKO: сохранённый токен, при 401 — реавторизация и повтор */
async function mytkoGetJson(
  cfg: MytkoConfig,
  path: string,
  search?: Record<string, string>
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const base = normalizeApiUrl(cfg.apiUrl);
  if (!base) return { ok: false, error: 'Не указан адрес API MyTKO' };

  let auth = await mytkoAuthenticate(cfg);
  if (!auth.ok) return auth;

  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(search ?? {})) url.searchParams.set(k, v);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: AbortSignal.timeout(15000),
      });
      // Токен протух — получаем новый и повторяем один раз
      if (res.status === 401 && attempt === 0) {
        auth = await mytkoAuthenticate(cfg, { force: true });
        if (!auth.ok) return auth;
        continue;
      }
      if (!res.ok) return { ok: false, error: `MyTKO HTTP ${res.status}` };
      return { ok: true, data: await res.json() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'ошибка сети' };
    }
  }
  return { ok: false, error: 'MyTKO: не удалось выполнить запрос' };
}

// ─── Отчёты водителей (факт вывоза по КП) ────────────────────────────────────

function mapReport(r: Record<string, unknown>): MytkoDriverReport {
  const removal = r.removalTs;
  const removalTs =
    typeof removal === 'number'
      ? new Date(removal).toISOString()
      : typeof removal === 'string'
        ? removal
        : null;
  const area = r.area as { lkCode?: string; name?: string; address?: string } | undefined;
  const notRemoved = Array.isArray(r.notRemovedContainers) ? r.notRemovedContainers.length : 0;
  return {
    id: String(r.id ?? ''),
    removalTs,
    vehicleNumber: (r.vehicleNumber as string) ?? null,
    lkCode: area?.lkCode ?? (r.lkCode as string) ?? null,
    areaName: area?.name ?? area?.address ?? (r.areaName as string) ?? null,
    factContainersAmount: typeof r.factContainersAmount === 'number' ? r.factContainersAmount : null,
    pickedUpVolume: typeof r.pickedUpVolume === 'number' ? r.pickedUpVolume : null,
    notRemoved,
  };
}

export async function mytkoGetDriverReports(
  cfg: MytkoConfig,
  opts?: { fromIso?: string; toIso?: string }
): Promise<{ ok: true; reports: MytkoDriverReport[] } | { ok: false; error: string }> {
  const to = opts?.toIso ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const from = opts?.fromIso ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const lk = (cfg.lkCodes ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const res = await mytkoGetJson(cfg, '/app/api/v1/admin/task/getReportsForLk', {
    dateAppTzFrom: from,
    dateAppTzTo: to,
    ...(lk.length ? { lkCodes: lk.join(',') } : {}),
  });
  if (!res.ok) return res;

  const data = res.data as Array<Record<string, unknown>>;
  const reports = (Array.isArray(data) ? data : [])
    .map(mapReport)
    .sort((a, b) => (b.removalTs ?? '').localeCompare(a.removalTs ?? ''))
    .slice(0, 50);
  return { ok: true, reports };
}

// ─── Синхронизация заявки с MyTKO ────────────────────────────────────────────
//
// Заявки на вывоз (REMOVAL_REQUEST) по документации передаются в ЧЛ через Kafka
// (доступ выдаёт поддержка). Пока доступ к Kafka не выдан, «синхронизация»
// заявки — это сверка с MyTKO по REST: проверяем токен (логин/пароль),
// получаем отчёты водителей за период заявки и ищем факт вывоза по адресу/КП.
// Найден факт → статус synced + сводка (машина, дата); нет факта — synced
// «вывоз не подтверждён»; связь/доступы не работают → error + текст ошибки.

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
  order: { city: string | null; address: string | null; createdAt: Date }
): Promise<MytkoOrderSyncResult> {
  const fromIso = new Date(order.createdAt.getTime() - 24 * 3600 * 1000).toISOString();
  const res = await mytkoGetDriverReports(cfg, { fromIso });
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

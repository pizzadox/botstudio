/**
 * Интеграция с MyTKO (mytko.ru — «Чистая логистика», платформа вывоза отходов).
 *
 * Официальная документация: https://docs.mytko.ru/docs/disp/API
 *
 * Что подтверждено документацией:
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
 *
 * Экспорт отчётов в Kafka: POST /app/api/v1/admin/task/exportNewOrChangedReportsToLk
 */

export interface MytkoConfig {
  enabled: boolean;
  /** База REST API, например https://disp.t2.groupstp.ru */
  apiUrl?: string;
  username?: string;
  password?: string;
  /** Коды КП (лицевые коды контейнерных площадок), через запятую */
  lkCodes?: string;
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
    };
  } catch {
    return { enabled: false, apiUrl: '', username: '', password: '', lkCodes: '' };
  }
}

export interface MytkoDriverReport {
  id: string;
  /** Дата и время вывоза */
  removalTs: string | null;
  /** Номер транспортного средства (машина, назначенная/выполнявшая вывоз) */
  vehicleNumber: string | null;
  /** Код контейнерной площадки */
  lkCode: string | null;
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

export async function mytkoAuthenticate(cfg: MytkoConfig): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const base = (cfg.apiUrl ?? '').trim().replace(/\/+$/, '');
  const key = `${base}|${cfg.username ?? ''}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { ok: true, token: cached.token };

  if (!base || !cfg.username || !cfg.password) {
    return { ok: false, error: 'Заполните API-адрес, логин и пароль MyTKO' };
  }

  try {
    const res = await fetch(`${base}/app/api/v1/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cfg.username, password: cfg.password }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
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

// ─── Отчёты водителей (факт вывоза по КП) ────────────────────────────────────

export async function mytkoGetDriverReports(
  cfg: MytkoConfig,
  opts?: { fromIso?: string; toIso?: string }
): Promise<{ ok: true; reports: MytkoDriverReport[] } | { ok: false; error: string }> {
  const auth = await mytkoAuthenticate(cfg);
  if (!auth.ok) return auth;

  const base = (cfg.apiUrl ?? '').trim().replace(/\/+$/, '');
  const url = new URL(`${base}/app/api/v1/admin/task/getReportsForLk`);
  const to = opts?.toIso ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const from = opts?.fromIso ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  url.searchParams.set('dateAppTzFrom', from);
  url.searchParams.set('dateAppTzTo', to);
  const lk = (cfg.lkCodes ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (lk.length) url.searchParams.set('lkCodes', lk.join(','));

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${auth.token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ok: false, error: `MyTKO HTTP ${res.status}` };
    const data = (await res.json()) as Array<Record<string, unknown>>;
    const reports: MytkoDriverReport[] = (Array.isArray(data) ? data : [])
      .map((r) => {
        const removal = r.removalTs;
        const removalTs =
          typeof removal === 'number'
            ? new Date(removal).toISOString()
            : typeof removal === 'string'
              ? removal
              : null;
        const area = r.area as { lkCode?: string } | undefined;
        const notRemoved = Array.isArray(r.notRemovedContainers) ? r.notRemovedContainers.length : 0;
        return {
          id: String(r.id ?? ''),
          removalTs,
          vehicleNumber: (r.vehicleNumber as string) ?? null,
          lkCode: area?.lkCode ?? null,
          factContainersAmount: typeof r.factContainersAmount === 'number' ? r.factContainersAmount : null,
          pickedUpVolume: typeof r.pickedUpVolume === 'number' ? r.pickedUpVolume : null,
          notRemoved,
        };
      })
      .sort((a, b) => (b.removalTs ?? '').localeCompare(a.removalTs ?? ''))
      .slice(0, 50);
    return { ok: true, reports };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'ошибка сети' };
  }
}

// ─── Передача заявки (REMOVAL_REQUEST) ───────────────────────────────────────
//
// По документации заявки на вывоз передаются в MyTKO через Apache Kafka
// (топик EXTERNAL_SYNC_DSP_IMPORT_{server_name}, entityType=REMOVAL_REQUEST) —
// брокер, топик и server_name выдаёт техподдержка mytko@groupstp.ru под
// конкретную интеграцию. REST-метода создания заявки в открытой документации нет.
//
// Контракт сообщения (по модели из документации):
// {
//   "entityType": "REMOVAL_REQUEST",
//   "status": "ACTIVE",
//   "id": "<uuid заявки>",
//   "address": "...", "comment": "...",
//   "wasteType": "TKO" | "KGM" | ...,
//   "desiredDate": "2026-01-20",
//   ...
// }
//
// Когда появятся доступы — здесь добавляется producer (kafkajs) или HTTP-bridge.
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

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import {
  maskToken,
  mytkoAuthenticate,
  mytkoFetchAllAreas,
  mytkoGetDriverReports,
  mytkoWhoAmI,
  normalizeApiUrl,
  parseMytkoConfig,
  serializeMytkoConfig,
  getFreshToken,
  getAreaCodesCached,
  getAreasCached,
  invalidateAreaCodesCache,
  type MytkoDirections,
  type MytkoConfig,
} from '@/lib/mytko';

type Params = { params: Promise<{ id: string }> };

/** Per-bot лок на sync-areas (globalThis — переживает HMR в dev) */
const syncLockGlobals = globalThis as unknown as {
  __mytkoAreaSync?: Map<string, boolean>;
};

/**
 * Авто-реавторизация в mytkoGraphQL могла обновить токен (старый истёк).
 * Сохраняем свежий токен в bot.mytkoConfig — иначе после перезапуска сервера
 * каждый первый запрос снова падает на протухшем токене.
 */
async function persistFreshToken(botId: string, cfg: MytkoConfig) {
  if (!cfg.enabled) return;
  const fresh = getFreshToken(cfg.apiUrl, cfg.username);
  if (fresh && fresh !== cfg.token) {
    cfg.token = fresh;
    cfg.tokenIssuedAt = new Date().toISOString();
    // serializeMytkoConfig — пароль остаётся зашифрованным (IMP-BE21-09)
    await db.bot.update({ where: { id: botId }, data: { mytkoConfig: serializeMytkoConfig(cfg) } });
  }
}

async function loadOwnedBot(req: NextRequest, botId: string) {
  const user = await getSessionUser(req);
  if (!user) return { error: 'unauthorized' as const };
  const bot = await db.bot.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== user.id) return { error: 'notfound' as const };
  return { user, bot };
}

/** Разбор конфига с понятной ошибкой, если пароль зашифрован, а APP_SECRET недоступен */
function parseCfgOr500(raw: string): { cfg: ReturnType<typeof parseMytkoConfig> } | { error: NextResponse } {
  try {
    return { cfg: parseMytkoConfig(raw) };
  } catch (e) {
    return {
      error: NextResponse.json(
        { error: e instanceof Error ? e.message : 'Ошибка конфигурации MyTKO' },
        { status: 500 }
      ),
    };
  }
}

/** Коды КП, по которым сверяем отчёты: реестр (все возможные) или ручной список.
 *  Реестр (~11k кодов) читается через кэш TTL 5 мин — не findMany на каждый запрос.
 *  Если известен город (IMP-BE21-08б) — реестр префильтруется по адресу:
 *  address.toLowerCase().includes(city.toLowerCase()); после фильтра пусто —
 *  фолбэк на полный реестр. Ручные коды (lkCodes) добавляются всегда. */
async function resolveAreaCodes(
  botId: string,
  cfg: ReturnType<typeof parseMytkoConfig>,
  city?: string | null
) {
  const manual = (cfg.lkCodes ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (city) {
    const areas = await getAreasCached(botId);
    const needle = city.toLowerCase();
    const filtered = areas
      .filter((a) => (a.address ?? '').toLowerCase().includes(needle))
      .map((a) => a.lkCode);
    return [...new Set([...(filtered.length > 0 ? filtered : areas.map((a) => a.lkCode)), ...manual])];
  }

  const registry = await getAreaCodesCached(botId);
  if (cfg.useAllAreas && registry.length > 0) return registry;
  // Реестр + ручные коды (если реестр ещё не загружен — работаем по ручным)
  return [...new Set([...registry, ...manual])];
}

/** Настройки интеграции MyTKO (пароль и токен маскируются) */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const loaded = await loadOwnedBot(req, id);
  if ('error' in loaded) {
    return NextResponse.json(
      { error: loaded.error === 'unauthorized' ? 'Требуется авторизация' : 'Бот не найден' },
      { status: loaded.error === 'unauthorized' ? 401 : 404 }
    );
  }
  const cfgOrError = parseCfgOr500(loaded.bot.mytkoConfig);
  if ('error' in cfgOrError) return cfgOrError.error;
  const areasCount = await db.mytkoArea.count({ where: { botId: loaded.bot.id } });
  return NextResponse.json({
    config: {
      enabled: cfgOrError.cfg.enabled,
      apiUrl: cfgOrError.cfg.apiUrl,
      username: cfgOrError.cfg.username,
      lkCodes: cfgOrError.cfg.lkCodes,
      useAllAreas: cfgOrError.cfg.useAllAreas === true,
      directions: cfgOrError.cfg.directions,
      hasPassword: !!cfgOrError.cfg.password,
      tokenMasked: maskToken(cfgOrError.cfg.token),
      tokenIssuedAt: cfgOrError.cfg.tokenIssuedAt || null,
      areasSyncedAt: cfgOrError.cfg.areasSyncedAt || null,
      areasCount,
    },
  });
}

/** Сохранить настройки / войти по логину-паролю за токеном / проверить / отчёты / реестр КП */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const loaded = await loadOwnedBot(req, id);
  if ('error' in loaded) {
    return NextResponse.json(
      { error: loaded.error === 'unauthorized' ? 'Требуется авторизация' : 'Бот не найден' },
      { status: loaded.error === 'unauthorized' ? 401 : 404 }
    );
  }
  const { bot } = loaded;
  const cfgOrError = parseCfgOr500(bot.mytkoConfig);
  if ('error' in cfgOrError) return cfgOrError.error;
  const cfg = cfgOrError.cfg;

  try {
    const body = (await req.json()) as {
      action?: 'save' | 'login' | 'test' | 'reports' | 'sync-areas';
      enabled?: boolean;
      apiUrl?: string;
      username?: string;
      password?: string;
      lkCodes?: string;
      useAllAreas?: boolean;
      directions?: Partial<MytkoDirections>;
      fromIso?: string;
      toIso?: string;
      city?: string;
    };

    // Пароль шифруется при ЗАПИСИ (serializeMytkoConfig → AES-256-GCM, IMP-BE21-09);
    // в памяти cfg.password всегда plaintext (расшифрован при чтении)
    const persist = () =>
      db.bot.update({ where: { id: bot.id }, data: { mytkoConfig: serializeMytkoConfig(cfg) } });

    if (body.action === 'save') {
      if (body.enabled !== undefined) cfg.enabled = !!body.enabled;
      if (typeof body.apiUrl === 'string') cfg.apiUrl = normalizeApiUrl(body.apiUrl);
      if (typeof body.username === 'string') cfg.username = body.username.trim();
      // Пустой пароль = не менять (поле ввода маскируется). Шифрование — при записи.
      if (typeof body.password === 'string' && body.password.trim()) cfg.password = body.password.trim();
      if (typeof body.lkCodes === 'string') cfg.lkCodes = body.lkCodes.trim();
      if (body.useAllAreas !== undefined) cfg.useAllAreas = !!body.useAllAreas;
      if (body.directions) {
        cfg.directions = { ...(cfg.directions ?? {}), ...body.directions } as MytkoDirections;
      }
      await persist();
      return NextResponse.json({ ok: true });
    }

    /** Вход по логину и паролю: получаем Bearer-токен (поле id_token) и сохраняем его */
    if (body.action === 'login') {
      if (typeof body.apiUrl === 'string') cfg.apiUrl = normalizeApiUrl(body.apiUrl);
      if (typeof body.username === 'string') cfg.username = body.username.trim();
      if (typeof body.password === 'string' && body.password.trim()) cfg.password = body.password.trim();

      const res = await mytkoAuthenticate(cfg, { force: true });
      if (!res.ok) {
        // Сохраняем введённые адрес/логин, чтобы не вводить заново
        await persist();
        return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
      }
      cfg.token = res.token;
      cfg.tokenIssuedAt = new Date().toISOString();
      await persist();
      return NextResponse.json({
        ok: true,
        tokenMasked: maskToken(cfg.token),
        tokenIssuedAt: cfg.tokenIssuedAt,
      });
    }

    if (body.action === 'test') {
      if (!cfg.enabled) return NextResponse.json({ ok: false, error: 'Интеграция выключена' }, { status: 400 });
      try {
        const res = await mytkoWhoAmI(cfg);
        if (res.ok) {
          return NextResponse.json({ ok: true, name: res.name, regions: res.regions });
        }
        // fallback: простая проверка токена
        const auth = await mytkoAuthenticate(cfg);
        return NextResponse.json(
          auth.ok ? { ok: true, name: cfg.username } : { ok: false, error: auth.error },
          { status: auth.ok ? 200 : 400 }
        );
      } finally {
        // IMP-BE21-13: свежий токен из авто-реавторизации сохраняем независимо
        // от успеха проверки (раньше при неуспехе/исключении он терялся)
        await persistFreshToken(bot.id, cfg).catch(() => {});
      }
    }

    if (body.action === 'reports') {
      if (!cfg.enabled) return NextResponse.json({ ok: false, error: 'Интеграция выключена' }, { status: 400 });
      try {
        // Город для префильтра КП (IMP-BE21-08б): явный city из запроса,
        // иначе — город последней заявки бота (отдельного «города бота» нет —
        // заявки пишут его в order.city). Города нет — полный реестр.
        let city = typeof body.city === 'string' ? body.city.trim() : '';
        if (!city) {
          const lastOrder = await db.order.findFirst({
            where: { botId: bot.id, city: { not: null } },
            orderBy: { createdAt: 'desc' },
            select: { city: true },
          });
          city = lastOrder?.city ?? '';
        }
        const areaCodes = await resolveAreaCodes(bot.id, cfg, city || null);
        const res = await mytkoGetDriverReports(cfg, {
          fromIso: body.fromIso,
          toIso: body.toIso,
          areaCodes,
        });
        if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
        return NextResponse.json({
          ok: true,
          reports: res.reports,
          areaCodes: areaCodes.length,
          city: city || null,
        });
      } finally {
        await persistFreshToken(bot.id, cfg).catch(() => {});
      }
    }

    /** Загрузить реестр всех КП проекта («все возможные КОДЫ КП») в локальный кэш */
    if (body.action === 'sync-areas') {
      if (!cfg.enabled) return NextResponse.json({ ok: false, error: 'Интеграция выключена' }, { status: 400 });
      // Защита от параллельного запуска: синхронизация ~45 с, повторный клик
      // по кнопке не должен запускать вторую копию
      const syncLocks = (syncLockGlobals.__mytkoAreaSync ??= new Map<string, boolean>());
      if (syncLocks.get(bot.id)) {
        return NextResponse.json(
          { ok: false, error: 'Синхронизация уже выполняется' },
          { status: 409 }
        );
      }
      syncLocks.set(bot.id, true);
      try {
        const res = await mytkoFetchAllAreas(cfg);
        if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
        await persistFreshToken(bot.id, cfg).catch(() => {});

        // Bulk-upsert одним INSERT..ON CONFLICT чанками по 400 строк
        // (IMP-B15 / IMP-BE21-08в): раньше это были до ~11k отдельных upsert'ов
        // в $transaction. Транзакции порционно — по 5 чанков (2000 строк),
        // чтобы не держать длинную блокировку на весь реестр.
        const areas = res.areas;
        const now = Date.now();
        const CHUNK = 400;
        const chunks: (typeof areas)[] = [];
        for (let i = 0; i < areas.length; i += CHUNK) chunks.push(areas.slice(i, i + CHUNK));
        const GROUP = 5;
        for (let gi = 0; gi < chunks.length; gi += GROUP) {
          const group = chunks.slice(gi, gi + GROUP);
          await db.$transaction(
            group.map((chunk) =>
              db.$executeRaw`
                INSERT INTO "MytkoArea" ("id", "botId", "lkCode", "address", "lat", "lng", "createdAt", "updatedAt") VALUES
                ${Prisma.join(
                  chunk.map(
                    (a) =>
                      Prisma.sql`(${randomUUID()}, ${bot.id}, ${a.lkCode}, ${a.address}, ${a.lat}, ${a.lng}, ${now}, ${now})`
                  )
                )}
                ON CONFLICT ("botId", "lkCode") DO UPDATE SET
                  "address" = excluded."address",
                  "lat" = excluded."lat",
                  "lng" = excluded."lng",
                  "updatedAt" = excluded."updatedAt"
              `
            )
          );
        }
        cfg.areasSyncedAt = new Date().toISOString();
        cfg.useAllAreas = true;
        await persist();
        // Реестр обновлён — сбрасываем кэши кодов и полного реестра этого бота
        invalidateAreaCodesCache(bot.id);
        return NextResponse.json({ ok: true, count: areas.length });
      } finally {
        syncLocks.delete(bot.id);
      }
    }

    return NextResponse.json({ ok: false, error: 'Неизвестное действие' }, { status: 400 });
  } catch (err) {
    console.error('[mytko]', err);
    return NextResponse.json({ error: 'Ошибка запроса' }, { status: 500 });
  }
}

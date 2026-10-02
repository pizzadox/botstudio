import { NextRequest, NextResponse } from 'next/server';
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
  type MytkoDirections,
} from '@/lib/mytko';

type Params = { params: Promise<{ id: string }> };

async function loadOwnedBot(req: NextRequest, botId: string) {
  const user = await getSessionUser(req);
  if (!user) return { error: 'unauthorized' as const };
  const bot = await db.bot.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== user.id) return { error: 'notfound' as const };
  return { user, bot };
}

/** Коды КП, по которым сверяем отчёты: реестр (все возможные) или ручной список */
async function resolveAreaCodes(botId: string, cfg: ReturnType<typeof parseMytkoConfig>) {
  const areas = await db.mytkoArea.findMany({
    where: { botId },
    select: { lkCode: true },
  });
  const registry = areas.map((a) => a.lkCode);
  if (cfg.useAllAreas && registry.length > 0) return registry;
  const manual = (cfg.lkCodes ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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
  const cfg = parseMytkoConfig(loaded.bot.mytkoConfig);
  const areasCount = await db.mytkoArea.count({ where: { botId: loaded.bot.id } });
  return NextResponse.json({
    config: {
      enabled: cfg.enabled,
      apiUrl: cfg.apiUrl,
      username: cfg.username,
      lkCodes: cfg.lkCodes,
      useAllAreas: cfg.useAllAreas === true,
      directions: cfg.directions,
      hasPassword: !!cfg.password,
      tokenMasked: maskToken(cfg.token),
      tokenIssuedAt: cfg.tokenIssuedAt || null,
      areasSyncedAt: cfg.areasSyncedAt || null,
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
  const cfg = parseMytkoConfig(bot.mytkoConfig);

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
    };

    const persist = () =>
      db.bot.update({ where: { id: bot.id }, data: { mytkoConfig: JSON.stringify(cfg) } });

    if (body.action === 'save') {
      if (body.enabled !== undefined) cfg.enabled = !!body.enabled;
      if (typeof body.apiUrl === 'string') cfg.apiUrl = normalizeApiUrl(body.apiUrl);
      if (typeof body.username === 'string') cfg.username = body.username.trim();
      // Пустой пароль = не менять (поле ввода маскируется)
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
    }

    if (body.action === 'reports') {
      if (!cfg.enabled) return NextResponse.json({ ok: false, error: 'Интеграция выключена' }, { status: 400 });
      const areaCodes = await resolveAreaCodes(bot.id, cfg);
      const res = await mytkoGetDriverReports(cfg, {
        fromIso: body.fromIso,
        toIso: body.toIso,
        areaCodes,
      });
      if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
      return NextResponse.json({ ok: true, reports: res.reports, areaCodes: areaCodes.length });
    }

    /** Загрузить реестр всех КП проекта («все возможные КОДЫ КП») в локальный кэш */
    if (body.action === 'sync-areas') {
      if (!cfg.enabled) return NextResponse.json({ ok: false, error: 'Интеграция выключена' }, { status: 400 });
      const res = await mytkoFetchAllAreas(cfg);
      if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });

      //Upsert порциями — SQLite не любит огромные пакеты
      const areas = res.areas;
      for (let i = 0; i < areas.length; i += 500) {
        const chunk = areas.slice(i, i + 500);
        await db.$transaction(
          chunk.map((a) =>
            db.mytkoArea.upsert({
              where: { botId_lkCode: { botId: bot.id, lkCode: a.lkCode } },
              create: { botId: bot.id, lkCode: a.lkCode, address: a.address, lat: a.lat, lng: a.lng },
              update: { address: a.address, lat: a.lat, lng: a.lng },
            })
          )
        );
      }
      cfg.areasSyncedAt = new Date().toISOString();
      cfg.useAllAreas = true;
      await persist();
      return NextResponse.json({ ok: true, count: areas.length });
    }

    return NextResponse.json({ ok: false, error: 'Неизвестное действие' }, { status: 400 });
  } catch (err) {
    console.error('[mytko]', err);
    return NextResponse.json({ error: 'Ошибка запроса' }, { status: 500 });
  }
}

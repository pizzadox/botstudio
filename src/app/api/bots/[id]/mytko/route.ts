import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import {
  maskToken,
  mytkoAuthenticate,
  mytkoGetDriverReports,
  normalizeApiUrl,
  parseMytkoConfig,
} from '@/lib/mytko';

type Params = { params: Promise<{ id: string }> };

async function loadOwnedBot(req: NextRequest, botId: string) {
  const user = await getSessionUser(req);
  if (!user) return { error: 'unauthorized' as const };
  const bot = await db.bot.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== user.id) return { error: 'notfound' as const };
  return { user, bot };
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
  return NextResponse.json({
    config: {
      enabled: cfg.enabled,
      apiUrl: cfg.apiUrl,
      username: cfg.username,
      lkCodes: cfg.lkCodes,
      hasPassword: !!cfg.password,
      tokenMasked: maskToken(cfg.token),
      tokenIssuedAt: cfg.tokenIssuedAt || null,
    },
  });
}

/** Сохранить настройки / войти по логину-паролю за токеном / проверить / отчёты */
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
      action?: 'save' | 'login' | 'test' | 'reports';
      enabled?: boolean;
      apiUrl?: string;
      username?: string;
      password?: string;
      lkCodes?: string;
      fromIso?: string;
      toIso?: string;
    };

    if (body.action === 'save') {
      if (body.enabled !== undefined) cfg.enabled = !!body.enabled;
      if (typeof body.apiUrl === 'string') cfg.apiUrl = normalizeApiUrl(body.apiUrl);
      if (typeof body.username === 'string') cfg.username = body.username.trim();
      // Пустой пароль = не менять (поле ввода маскируется)
      if (typeof body.password === 'string' && body.password.trim()) cfg.password = body.password.trim();
      if (typeof body.lkCodes === 'string') cfg.lkCodes = body.lkCodes.trim();
      await db.bot.update({
        where: { id: bot.id },
        data: { mytkoConfig: JSON.stringify(cfg) },
      });
      return NextResponse.json({ ok: true });
    }

    /** Вход по логину и паролю: получаем Bearer-токен и сохраняем его в настройках */
    if (body.action === 'login') {
      if (typeof body.apiUrl === 'string') cfg.apiUrl = normalizeApiUrl(body.apiUrl);
      if (typeof body.username === 'string') cfg.username = body.username.trim();
      if (typeof body.password === 'string' && body.password.trim()) cfg.password = body.password.trim();

      const res = await mytkoAuthenticate(cfg, { force: true });
      if (!res.ok) {
        // Сохраняем введённые адрес/логин, чтобы не вводить заново
        await db.bot.update({
          where: { id: bot.id },
          data: { mytkoConfig: JSON.stringify(cfg) },
        });
        return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
      }
      cfg.token = res.token;
      cfg.tokenIssuedAt = new Date().toISOString();
      await db.bot.update({
        where: { id: bot.id },
        data: { mytkoConfig: JSON.stringify(cfg) },
      });
      return NextResponse.json({
        ok: true,
        tokenMasked: maskToken(cfg.token),
        tokenIssuedAt: cfg.tokenIssuedAt,
      });
    }

    if (body.action === 'test') {
      if (!cfg.enabled) return NextResponse.json({ ok: false, error: 'Интеграция выключена' }, { status: 400 });
      const res = await mytkoAuthenticate(cfg);
      return NextResponse.json(res.ok ? { ok: true } : { ok: false, error: res.error }, {
        status: res.ok ? 200 : 400,
      });
    }

    if (body.action === 'reports') {
      if (!cfg.enabled) return NextResponse.json({ ok: false, error: 'Интеграция выключена' }, { status: 400 });
      const res = await mytkoGetDriverReports(cfg, { fromIso: body.fromIso, toIso: body.toIso });
      if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
      return NextResponse.json({ ok: true, reports: res.reports });
    }

    return NextResponse.json({ ok: false, error: 'Неизвестное действие' }, { status: 400 });
  } catch (err) {
    console.error('[mytko]', err);
    return NextResponse.json({ error: 'Ошибка запроса' }, { status: 500 });
  }
}

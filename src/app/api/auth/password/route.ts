import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  getSessionUser,
  getTokenFromRequest,
  hashPassword,
  verifyPassword,
} from '@/lib/auth';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { inc } from '@/lib/metrics';

/**
 * Смена пароля (22-BE2, IMP-BE22-06).
 * POST { currentPassword, newPassword } → { ok: true }
 *  - обязательна авторизация;
 *  - текущий пароль проверяется (verifyPassword);
 *  - новый ≥ 6 символов;
 *  - после смены все ДРУГИЕ сессии пользователя удаляются (текущая остаётся).
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  // IMP-BE22-08: не больше 10 попыток смены пароля с одного ip за 15 минут
  if (!rateLimit(`pwd:${clientIp(req)}`, 10, 15 * 60_000)) {
    inc('rateLimited');
    return NextResponse.json({ error: 'Слишком много попыток, попробуйте позже' }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => null);
    const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

    if (!currentPassword) {
      return NextResponse.json({ error: 'Укажите текущий пароль' }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: 'Новый пароль должен быть не короче 6 символов' }, { status: 400 });
    }

    const dbUser = await db.user.findUnique({ where: { id: user.id } });
    if (!dbUser) return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });

    if (!(await verifyPassword(currentPassword, dbUser.password))) {
      return NextResponse.json({ error: 'Текущий пароль неверен' }, { status: 400 });
    }

    const password = await hashPassword(newPassword);
    await db.user.update({ where: { id: user.id }, data: { password } });

    // Завершить все другие сессии пользователя (текущая — по токену из запроса)
    const currentToken = getTokenFromRequest(req);
    const removed = await db.session.deleteMany({
      where: { userId: user.id, ...(currentToken ? { id: { not: currentToken } } : {}) },
    });
    if (removed.count > 0) {
      console.log(`[auth/password] user ${user.username}: закрыто других сессий: ${removed.count}`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[auth/password]', err);
    return NextResponse.json({ error: 'Не удалось сменить пароль' }, { status: 500 });
  }
}

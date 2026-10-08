import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createSession, SESSION_COOKIE, sessionCookieOptions, verifyPassword } from '@/lib/auth';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { inc } from '@/lib/metrics';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = String(body.username ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');

    // IMP-BE21-04: брутфорс-защита — не больше 5 попыток на ip+логин за 15 минут
    if (!rateLimit(`login:${clientIp(req)}:${username}`, 5, 15 * 60_000)) {
      inc('rateLimited');
      return NextResponse.json(
        { error: 'Слишком много попыток, попробуйте позже' },
        { status: 429 }
      );
    }

    const user = await db.user.findUnique({ where: { username } });
    if (!user || !(await verifyPassword(password, user.password))) {
      return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 });
    }

    const session = await createSession(user.id);
    const res = NextResponse.json({
      user: { id: user.id, username: user.username, name: user.name },
      token: session.id,
    });
    res.cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions(session.expiresAt));
    return res;
  } catch (err) {
    console.error('[auth/login]', err);
    return NextResponse.json({ error: 'Не удалось войти' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createSession, SESSION_COOKIE, sessionCookieOptions, verifyPassword } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = String(body.username ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');

    const user = await db.user.findUnique({ where: { username } });
    if (!user || !verifyPassword(password, user.password)) {
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

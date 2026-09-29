import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createSession, hashPassword, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = String(body.username ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const name = String(body.name ?? '').trim() || null;

    if (username.length < 3) {
      return NextResponse.json({ error: 'Логин должен быть не короче 3 символов' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Пароль должен быть не короче 6 символов' }, { status: 400 });
    }
    if (!/^[a-z0-9_.-]+$/.test(username)) {
      return NextResponse.json(
        { error: 'Логин может содержать только латиницу, цифры и символы _ . -' },
        { status: 400 }
      );
    }

    const exists = await db.user.findUnique({ where: { username } });
    if (exists) {
      return NextResponse.json({ error: 'Этот логин уже занят' }, { status: 409 });
    }

    const user = await db.user.create({
      data: { username, password: hashPassword(password), name },
    });

    const session = await createSession(user.id);
    const res = NextResponse.json({ user: { id: user.id, username: user.username, name: user.name } });
    res.cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions(session.expiresAt));
    return res;
  } catch (err) {
    console.error('[auth/register]', err);
    return NextResponse.json({ error: 'Не удалось создать аккаунт' }, { status: 500 });
  }
}

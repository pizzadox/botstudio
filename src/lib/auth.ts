import { db } from '@/lib/db';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { promisify } from 'util';

const SESSION_COOKIE = 'bstudio_session';
const SESSION_DAYS = 30;

/** scryptSync блокирует event loop (~100 мс на вызов) — на логине/регистрации
 *  подвешивал весь сервер. Промисифицированный асинхронный crypto.scrypt. */
const scryptAsync = promisify(crypto.scrypt) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>;

// ─── Пароли ──────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  try {
    const test = await scryptAsync(password, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), test);
  } catch {
    return false;
  }
}

// ─── Сессии ──────────────────────────────────────────────────────────────────

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await db.session.create({ data: { id, userId, expiresAt } });
  return { id, expiresAt };
}

export interface SessionUser {
  id: string;
  username: string;
  name: string | null;
}

/**
 * Достаём токен сессии: сначала из заголовка Authorization: Bearer <token>,
 * затем из cookie. Заголовок нужен, когда cookie недоступны
 * (например, приложение открыто в iframe — браузеры блокируют сторонние cookie).
 */
export function getTokenFromRequest(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  return req.cookies.get(SESSION_COOKIE)?.value ?? null;
}

export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { id: token },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return { id: session.user.id, username: session.user.username, name: session.user.name };
}

export async function destroySession(req: NextRequest): Promise<void> {
  const token = getTokenFromRequest(req);
  if (token) {
    await db.session.delete({ where: { id: token } }).catch(() => {});
  }
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

export { SESSION_COOKIE };

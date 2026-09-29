// Клиентский helper для запросов к API.
//
// Аутентификация двойная:
//  1) cookie bstudio_session (обычный режим);
//  2) Bearer-токен в localStorage (когда cookie заблокированы —
//     например, приложение открыто в iframe с запретом сторонних cookie).

const TOKEN_KEY = 'bstudio_token';

export function getAuthToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage недоступен — останется только cookie
  }
}

export function clearAuthToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });

  // Потеряли авторизацию не на форме входа — сбрасываем токен и уводим на экран входа
  if (res.status === 401 && !url.startsWith('/api/auth/login') && !url.startsWith('/api/auth/register')) {
    clearAuthToken();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('bstudio:unauthorized'));
    }
  }

  let data: unknown = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const msg =
      (data as { error?: string })?.error ||
      `Ошибка запроса (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

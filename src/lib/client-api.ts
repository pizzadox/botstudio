// Клиентский helper для запросов к API

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
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

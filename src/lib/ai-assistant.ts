import { db } from '@/lib/db';
import type { AiAssistantConfig } from '@/lib/flow-engine';

/**
 * Разбор сохранённой настройки Bot.aiConfig (JSON-строка).
 * Никогда не бросает исключений — битый JSON означает «выключено».
 */
export function parseAiConfig(raw: string | null | undefined): AiAssistantConfig {
  if (!raw) return { enabled: false };
  try {
    const parsed = JSON.parse(raw) as Partial<AiAssistantConfig> | null;
    if (!parsed || typeof parsed !== 'object') return { enabled: false };
    return {
      enabled: parsed.enabled === true,
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : undefined,
      reaskMenu: parsed.reaskMenu !== false,
    };
  } catch {
    return { enabled: false };
  }
}

// ─── Кэш конфигурации ассистента (горячий путь вебхуков) ─────────────────────
// loadAssistantConfig на каждое входящее сообщение делала запрос базы знаний.
// Кэшируем собранный конфиг на 60 секунд; инвалидация — при сохранении
// настроек ИИ (PUT /api/bots/[id]/ai) и правках базы знаний.

const cacheGlobals = globalThis as unknown as {
  __assistantConfigCache?: Map<string, { data: AiAssistantConfig; expiresAt: number }>;
};

const ASSISTANT_CACHE_TTL = 60 * 1000;

/** Сбросить кэш конфига ассистента бота (вызывать после изменений настроек/БЗ) */
export function invalidateAssistantConfig(botId: string): void {
  const cache = (cacheGlobals.__assistantConfigCache ??= new Map());
  cache.delete(botId);
}

/**
 * Загружает конфигурацию ИИ-ассистента бота: настройки + база знаний.
 * Записи базы знаний склеиваются в единый текст и передаются движку.
 * Если ассистент выключен, возвращает { enabled: false } (поведение
 * сценария остаётся прежним).
 */
export async function loadAssistantConfig(
  botId: string,
  aiConfigRaw: string | null | undefined
): Promise<AiAssistantConfig> {
  const cfg = parseAiConfig(aiConfigRaw);
  if (!cfg.enabled) return { enabled: false };

  const cache = (cacheGlobals.__assistantConfigCache ??= new Map());
  const hit = cache.get(botId);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  const items = await db.knowledgeItem.findMany({
    where: { botId },
    orderBy: { createdAt: 'asc' },
    select: { title: true, content: true },
  });

  const kbText = items
    .map((i) => [i.title?.trim() ? `# ${i.title.trim()}` : '', i.content?.trim() ?? ''].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n');

  const knowledge = [cfg.knowledge, kbText].filter((s): s is string => Boolean(s && s.trim())).join('\n\n');

  const result: AiAssistantConfig = { ...cfg, knowledge: knowledge || undefined };
  cache.set(botId, { data: result, expiresAt: Date.now() + ASSISTANT_CACHE_TTL });
  return result;
}

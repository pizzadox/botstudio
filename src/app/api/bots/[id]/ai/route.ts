import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { parseAiConfig, invalidateAssistantConfig } from '@/lib/ai-assistant';

type Params = { params: Promise<{ id: string }> };

/** GET: настройки ИИ-ассистента + записи базы знаний бота */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  const knowledge = await db.knowledgeItem.findMany({
    where: { botId: id },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ aiConfig: parseAiConfig(bot.aiConfig), knowledge });
}

/** PUT: сохранить настройки ИИ-ассистента */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  try {
    const body = (await req.json()) as { enabled?: boolean; prompt?: string; reaskMenu?: boolean };
    const aiConfig = {
      enabled: body.enabled === true,
      prompt: typeof body.prompt === 'string' ? body.prompt.slice(0, 4000) : '',
      reaskMenu: body.reaskMenu !== false,
    };
    await db.bot.update({ where: { id }, data: { aiConfig: JSON.stringify(aiConfig) } });
    // Сбрасываем кэш конфига ассистента (TTL 60 с) — изменения вступают сразу
    invalidateAssistantConfig(id);
    return NextResponse.json({ ok: true, aiConfig });
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }
}

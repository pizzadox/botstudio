import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { runEngine } from '@/lib/flow-engine';
import type { EngineState, Flow } from '@/lib/flow-types';

type Params = { params: Promise<{ id: string }> };

/**
 * Симулятор чата: выполняет сценарий бота без сохранения в БД.
 * Состояние (память) диалога передаётся туда-обратно клиенту.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  try {
    const body = await req.json();
    const input: string | null = body.input ? String(body.input).slice(0, 2000) : null;
    const state: EngineState | null = body.state ?? null;

    let flow: Flow = { nodes: [], edges: [] };
    try {
      flow = JSON.parse(bot.flow) as Flow;
    } catch {
      flow = { nodes: [], edges: [] };
    }

    const result = await runEngine(flow, input, state);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[simulate]', err);
    return NextResponse.json({ error: 'Ошибка выполнения сценария' }, { status: 500 });
  }
}

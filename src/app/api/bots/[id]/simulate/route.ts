import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { runEngine } from '@/lib/flow-engine';
import { loadAssistantConfig } from '@/lib/ai-assistant';
import { getFlowCached } from '@/lib/flow-cache';
import type { EngineState, Flow } from '@/lib/flow-types';

type Params = { params: Promise<{ id: string }> };

interface SimulateMessage {
  text: string;
  nodeId?: string | null;
  buttons?: { id: string; text: string }[];
  id?: string;
}

/**
 * Симулятор чата: выполняет сценарий бота.
 * Обычный режим — stateless (состояние передаётся туда-обратно клиенту).
 * Как только сценарий доходит до узла «Оператор» — создаём настоящий диалог
 * в БД со всей историей: он появляется в инбоксе, оператор может отвечать,
 * а тест-чат переходит в режим реального диалога (параметр conversationId).
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
    const conversationId: string | null = body.conversationId ?? null;

    // ── Валидация состояния (IMP-BE21-06) ──
    // Клиент возвращает state туда-обратно: слишком большой state — ошибка 400,
    // кривой — нормализация, а не 500 и не раздувание БД/промпта.
    let state: EngineState | null = body.state ?? null;
    if (state !== null) {
      if (typeof state !== 'object' || Array.isArray(state)) {
        state = null; // мусор вместо состояния — начинаем с чистого
      } else if (JSON.stringify(state).length > 32768) {
        return NextResponse.json({ error: 'Состояние слишком большое' }, { status: 400 });
      } else {
        // история — не более 50 последних записей (движок использует хвост)
        if (state.history !== undefined) {
          state.history = Array.isArray(state.history) ? state.history.slice(-50) : [];
        }
        // vars — только плоский объект ≤ 4096 байт
        if (state.vars !== undefined) {
          if (state.vars === null || typeof state.vars !== 'object' || Array.isArray(state.vars)) {
            state.vars = {};
          } else if (JSON.stringify(state.vars).length > 4096) {
            return NextResponse.json({ error: 'Состояние слишком большое' }, { status: 400 });
          }
        }
      }
    }

    // Распарсенный сценарий кэшируется по botId+updatedAt (см. flow-cache.ts)
    const flow: Flow = getFlowCached(bot.id, bot.updatedAt, bot.flow);

    // ── Режим реального диалога (после передачи оператору) ──
    if (conversationId) {
      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, botId: bot.id },
      });
      if (!conversation) {
        return NextResponse.json({ error: 'Диалог не найден' }, { status: 404 });
      }

      if (input) {
        await db.message.create({
          data: { conversationId: conversation.id, role: 'user', text: input },
        });
      }

      let convState: EngineState | null = null;
      try {
        convState = conversation.state ? (JSON.parse(conversation.state) as EngineState) : null;
      } catch {
        convState = null;
      }

      const assistant = await loadAssistantConfig(bot.id, bot.aiConfig);
      const result = await runEngine(flow, input, convState, assistant, {
        botId: bot.id,
        conversationId: conversation.id,
        externalUserId: conversation.externalUserId,
      });

      const messages: SimulateMessage[] = [];
      // createMany одним запросом (IMP-BE21-06): id созданных записей клиенту
      // не нужен — тест-чат рендерит только text/buttons, ids не использует
      if (result.messages.length > 0) {
        await db.message.createMany({
          data: result.messages.map((m) => ({
            conversationId: conversation.id,
            role: 'bot',
            text: m.text,
            nodeId: m.nodeId ?? null,
          })),
        });
      }
      for (const m of result.messages) messages.push({ ...m });

      await db.conversation.update({
        where: { id: conversation.id },
        data: {
          state: JSON.stringify(result.state),
          needsOperator: result.needsOperator ? true : conversation.needsOperator,
          updatedAt: new Date(),
        },
      });

      return NextResponse.json({
        messages,
        state: result.state,
        needsOperator: result.needsOperator,
        conversationId: conversation.id,
      });
    }

    // ── Обычный stateless-режим симулятора ──
    const assistant = await loadAssistantConfig(bot.id, bot.aiConfig);
    // ctx с botId: узел «Создать заявку» работает и в тест-чате
    const result = await runEngine(flow, input, state, assistant, { botId: bot.id });

    if (result.needsOperator) {
      // Материализуем диалог: оператор должен увидеть его в инбоксе
      const conversation = await db.conversation.create({
        data: {
          botId: bot.id,
          source: 'simulator',
          externalId: `sim_${crypto.randomBytes(10).toString('hex')}`,
          contact: 'Тест-чат',
          state: JSON.stringify(result.state),
          needsOperator: true,
        },
      });
      // История диалога — одним createMany (id записей не используются)
      if (result.state.history.length > 0) {
        await db.message.createMany({
          data: result.state.history.map((h) => ({
            conversationId: conversation.id,
            role: h.role,
            text: h.text,
          })),
        });
      }
      return NextResponse.json({
        messages: result.messages,
        state: result.state,
        needsOperator: true,
        conversationId: conversation.id,
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[simulate]', err);
    return NextResponse.json({ error: 'Ошибка выполнения сценария' }, { status: 500 });
  }
}

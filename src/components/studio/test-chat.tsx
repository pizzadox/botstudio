'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Headset, Loader2, RotateCcw, Send, X } from 'lucide-react';
import { api } from '@/lib/client-api';
import type { EngineMessage, EngineState, FlowButton } from '@/lib/flow-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ChatItem {
  id?: string;
  role: 'user' | 'bot';
  text: string;
  buttons?: FlowButton[];
  operator?: boolean;
}

interface SimulateResponse {
  messages: EngineMessage[];
  state: EngineState;
  needsOperator?: boolean;
  conversationId?: string;
}

export default function TestChat({
  botId,
  onClose,
  onOpenInbox,
}: {
  botId: string;
  onClose: () => void;
  onOpenInbox?: () => void;
}) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [convClosed, setConvClosed] = useState(false);
  const stateRef = useRef<EngineState | null>(null);
  const convRef = useRef<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const storageKey = `botstudio_test_conv_${botId}`;

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  };

  const run = useCallback(
    async (input: string | null) => {
      setTyping(true);
      try {
        const res = await api<SimulateResponse>(`/api/bots/${botId}/simulate`, {
          method: 'POST',
          body: JSON.stringify({
            input,
            state: stateRef.current,
            conversationId: convRef.current,
          }),
        });
        stateRef.current = res.state;
        if (res.conversationId) {
          convRef.current = res.conversationId;
          setConversationId(res.conversationId);
          try {
            window.localStorage.setItem(storageKey, res.conversationId);
          } catch {
            /* ignore */
          }
        }
        for (const m of res.messages) {
          setItems((prev) => [...prev, { role: 'bot', text: m.text, buttons: m.buttons }]);
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setItems((prev) => [
          ...prev,
          { role: 'bot', text: '⚠️ Ошибка выполнения сценария. Попробуйте ещё раз.' },
        ]);
      } finally {
        setTyping(false);
        scrollToBottom();
      }
    },
    [botId]
  );

  // Старт диалога при открытии; если диалог уже передан оператору — восстанавливаем его
  useEffect(() => {
    let cancelled = false;
    const saved = (() => {
      try {
        return window.localStorage.getItem(storageKey);
      } catch {
        return null;
      }
    })();

    const startFresh = () => {
      stateRef.current = null;
      seenIdsRef.current = new Set();
      run(null);
    };

    if (saved) {
      api<{
        conversation: { status: string };
        messages: { id: string; role: string; text: string; nodeId?: string | null }[];
      }>(`/api/conversations/${saved}`)
        .then((d) => {
          if (cancelled) return;
          convRef.current = saved;
          setConversationId(saved);
          setConvClosed(d.conversation.status === 'closed');
          for (const m of d.messages) {
            seenIdsRef.current.add(m.id);
            setItems((prev) => [
              ...prev,
              { id: m.id, role: m.role === 'user' ? 'user' : 'bot', text: m.text, operator: m.nodeId === '__operator' },
            ]);
          }
        })
        .catch(() => {
          if (cancelled) return;
          try {
            window.localStorage.removeItem(storageKey);
          } catch {
            /* ignore */
          }
          startFresh();
        });
    } else {
      startFresh();
    }

    return () => {
      cancelled = true;
    };
  }, [botId]);

  // Проверка новых сообщений оператора (после передачи диалога)
  const poll = useCallback(async () => {
    if (!convRef.current) return;
    try {
      const d = await api<{
        conversation: { needsOperator: boolean; status: string };
        messages: { id: string; role: string; text: string; nodeId?: string | null }[];
      }>(`/api/conversations/${convRef.current}`);
      let changed = false;
      for (const m of d.messages) {
        if (seenIdsRef.current.has(m.id)) continue;
        seenIdsRef.current.add(m.id);
        // Свои сообщения уже показаны локально; добавляем только реплики бота/оператора
        if (m.role === 'bot') {
          setItems((prev) => [
            ...prev,
            { id: m.id, role: 'bot', text: m.text, operator: m.nodeId === '__operator' },
          ]);
          changed = true;
        }
      }
      if (d.conversation.status === 'closed') setConvClosed((prev) => prev || true);
      if (changed) scrollToBottom();
    } catch {
      /* ignore polling errors */
    }
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    // Помечаем уже существующие сообщения диалога как показанные
    poll();
    const t = setInterval(poll, 2500);
    return () => clearInterval(t);
  }, [conversationId, poll]);

  const reset = () => {
    stateRef.current = null;
    convRef.current = null;
    seenIdsRef.current = new Set();
    setConversationId(null);
    setConvClosed(false);
    setItems([]);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    run(null);
  };

  const send = (text: string) => {
    const t = text.trim();
    if (!t || typing) return;
    setItems((prev) => [...prev, { role: 'user', text: t }]);
    setInput('');
    scrollToBottom();
    run(t);
  };

  const lastBotWithButtons = [...items].reverse().find((i) => i.role === 'bot' && i.buttons?.length);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b p-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bot className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight">Тестовый чат</div>
          <div className="text-[11px] text-muted-foreground">
            {conversationId && !convClosed
              ? 'диалог ведёт оператор'
              : typing
                ? 'бот печатает…'
                : convClosed
                  ? 'бот снова отвечает — сценарий продолжается'
                  : 'сценарий выполняется как в живом боте'}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Сбросить диалог"
          aria-label="Сбросить диалог"
          onClick={reset}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Закрыть чат">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {conversationId && (
        <div className="border-b bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <div className="flex items-start gap-2">
            <Headset className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              {convClosed
                ? 'Оператор закрыл обращение — бот снова отвечает сам. Продолжайте диалог или нажмите «Сбросить».'
                : 'Диалог передан оператору — он появился во «Входящих». Ответы оператора появятся здесь.'}
            </div>
            {onOpenInbox && !convClosed && (
              <button
                onClick={onOpenInbox}
                className="shrink-0 font-semibold underline underline-offset-2"
              >
                Открыть
              </button>
            )}
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto bg-muted/30 p-3">
        {items.map((m, i) => (
          <div key={m.id ?? `local-${i}`} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-snug',
                m.role === 'user'
                  ? 'rounded-br-md bg-primary text-primary-foreground'
                  : 'rounded-bl-md border bg-card'
              )}
            >
              {m.operator && (
                <div className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-amber-700">
                  <Headset className="h-3 w-3" /> оператор
                </div>
              )}
              {m.text}
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border bg-card px-3 py-2.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
            </div>
          </div>
        )}
        {items.length === 0 && !typing && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Нажмите «Сбросить», чтобы начать диалог
          </div>
        )}
      </div>

      {lastBotWithButtons?.buttons && (
        <div className="flex flex-wrap gap-2 border-t bg-background p-2.5">
          {lastBotWithButtons.buttons.map((b) => (
            <button
              key={b.id}
              onClick={() => send(b.text)}
              disabled={typing}
              className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
            >
              {b.text}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex items-center gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Input
          placeholder={
            conversationId && !convClosed ? 'Сообщение оператору…' : 'Введите сообщение…'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={typing}
        />
        <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={typing || !input.trim()}>
          {typing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}

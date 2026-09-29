'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Loader2, RotateCcw, Send, X } from 'lucide-react';
import { api } from '@/lib/client-api';
import type { EngineMessage, EngineState, FlowButton } from '@/lib/flow-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ChatItem {
  role: 'user' | 'bot';
  text: string;
  buttons?: FlowButton[];
}

export default function TestChat({
  botId,
  onClose,
}: {
  botId: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const stateRef = useRef<EngineState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  };

  const run = useCallback(
    async (input: string | null) => {
      setTyping(true);
      try {
        const res = await api<{ messages: EngineMessage[]; state: EngineState }>(
          `/api/bots/${botId}/simulate`,
          { method: 'POST', body: JSON.stringify({ input, state: stateRef.current }) }
        );
        stateRef.current = res.state;
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

  // Старт диалога при открытии
  useEffect(() => {
    stateRef.current = null;
    setItems([]);
    run(null);
  }, [run]);

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
            {typing ? 'бот печатает…' : 'сценарий выполняется как в живом боте'}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Сбросить диалог"
          aria-label="Сбросить диалог"
          onClick={() => {
            stateRef.current = null;
            setItems([]);
            run(null);
          }}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Закрыть чат">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto bg-muted/30 p-3">
        {items.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-snug',
                m.role === 'user'
                  ? 'rounded-br-md bg-primary text-primary-foreground'
                  : 'rounded-bl-md border bg-card'
              )}
            >
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
          placeholder="Введите сообщение…"
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

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  ChevronLeft,
  Globe,
  Headset,
  Inbox,
  Loader2,
  MessageCircle,
  MessagesSquare,
  MessageSquare,
  Send,
  SearchCheck,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import type { ChatMessage, ConversationListItem } from '@/lib/studio-types';
import { SOURCE_COLORS, SOURCE_LABELS } from '@/lib/studio-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

function SourceIcon({ source, className }: { source: string; className?: string }) {
  const cls = cn('h-3.5 w-3.5', className);
  switch (source) {
    case 'telegram':
      return <Send className={cls} />;
    case 'whatsapp':
      return <MessageCircle className={cls} />;
    case 'max':
      return <MessageSquare className={cls} />;
    default:
      return <Globe className={cls} />;
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.floor(h / 24)} дн назад`;
}

export default function InboxView({
  bot,
  onBack,
}: {
  bot: { id: string; name: string };
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [contact, setContact] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState('web');
  const [needsOperator, setNeedsOperator] = useState(false);
  const [status, setStatus] = useState('open');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    try {
      const d = await api<{ conversations: ConversationListItem[] }>(
        `/api/bots/${bot.id}/conversations`
      );
      setConversations(d.conversations);
    } catch {
      /* ignore polling errors */
    } finally {
      setLoading(false);
    }
  }, [bot.id]);

  const loadConversation = useCallback(async (id: string) => {
    try {
      const d = await api<{
        conversation: { contact: string | null; source: string; needsOperator: boolean; status: string };
        messages: ChatMessage[];
      }>(`/api/conversations/${id}`);
      setMessages(d.messages);
      setContact(d.conversation.contact);
      setSelectedSource(d.conversation.source);
      setNeedsOperator(d.conversation.needsOperator);
      setStatus(d.conversation.status);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    const t = setInterval(loadList, 6000);
    return () => clearInterval(t);
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return;
    loadConversation(selectedId);
    const t = setInterval(() => loadConversation(selectedId), 4000);
    return () => clearInterval(t);
  }, [selectedId, loadConversation]);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, [messages]);

  const sendReply = async () => {
    const t = reply.trim();
    if (!t || !selectedId) return;
    setSending(true);
    setReply('');
    try {
      const d = await api<{ message: ChatMessage }>(`/api/conversations/${selectedId}/operator`, {
        method: 'POST',
        body: JSON.stringify({ text: t }),
      });
      setMessages((prev) => [...prev, d.message]);
    } catch {
      toast({ title: 'Не удалось отправить', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const closeConversation = async () => {
    if (!selectedId) return;
    try {
      await api(`/api/conversations/${selectedId}/close`, { method: 'POST' });
      setNeedsOperator(false);
      setStatus('closed');
      toast({ title: 'Обращение закрыто' });
      loadList();
    } catch {
      toast({ title: 'Ошибка', variant: 'destructive' });
    }
  };

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} aria-label="Назад">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Inbox className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold">Входящие диалоги</h1>
          <Badge variant="secondary">{bot.name}</Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 md:grid-cols-[340px_1fr]">
        {/* Список диалогов */}
        <div className={cn('flex min-h-0 flex-col border-r', selected && 'hidden md:flex')}>
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
              <MessagesSquare className="h-10 w-10 opacity-30" />
              <p className="text-sm">
                Диалогов пока нет. Опубликуйте бота и напишите ему в демо-чате или мессенджере.
              </p>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="divide-y">
                {conversations.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      'flex w-full flex-col gap-1 p-3 text-left transition-colors hover:bg-muted/60',
                      selectedId === c.id && 'bg-primary/5'
                    )}
                  >
                    <div className="flex w-full items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                          SOURCE_COLORS[c.source] ?? 'bg-muted text-muted-foreground'
                        )}
                      >
                        <SourceIcon source={c.source} className="h-3 w-3" />
                        {SOURCE_LABELS[c.source] ?? c.source}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {c.contact || 'Без имени'}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {timeAgo(c.updatedAt)}
                      </span>
                    </div>
                    <p className="line-clamp-1 w-full text-xs text-muted-foreground">
                      {c.lastMessage
                        ? `${c.lastMessage.role === 'user' ? '' : 'Вы: '}${c.lastMessage.text}`
                        : 'Нет сообщений'}
                    </p>
                    <div className="flex gap-1.5">
                      {c.needsOperator && c.status === 'open' && (
                        <Badge variant="destructive" className="h-4 animate-pulse px-1.5 text-[9px]">
                          <Headset className="mr-0.5 h-2.5 w-2.5" /> нужен оператор
                        </Badge>
                      )}
                      {c.status === 'closed' && (
                        <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                          закрыт
                        </Badge>
                      )}
                      <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                        {c.messagesCount} сообщ.
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Просмотр диалога */}
        <div className={cn('flex min-h-0 flex-col', !selected && 'hidden md:flex')}>
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <SearchCheck className="h-10 w-10 opacity-30" />
              <p className="text-sm">Выберите диалог слева</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 md:hidden"
                  onClick={() => setSelectedId(null)}
                  aria-label="К списку"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    SOURCE_COLORS[selectedSource]
                  )}
                >
                  <SourceIcon source={selectedSource} className="h-3 w-3" />
                  {SOURCE_LABELS[selectedSource] ?? selectedSource}
                </span>
                <span className="text-sm font-medium">{contact || 'Гость'}</span>
                {needsOperator && status === 'open' && (
                  <Badge variant="destructive" className="animate-pulse">
                    <Headset className="mr-1 h-3 w-3" /> нужен оператор
                  </Badge>
                )}
                {status === 'closed' && <Badge variant="outline">закрыт</Badge>}
                <div className="ml-auto flex gap-2">
                  {needsOperator && status === 'open' && (
                    <Button size="sm" variant="outline" onClick={closeConversation}>
                      <Headset className="h-3.5 w-3.5" /> Закрыть обращение
                    </Button>
                  )}
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto bg-muted/30 p-4">
                {messages.map((m) => (
                  <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-start' : 'justify-end')}>
                    <div
                      className={cn(
                        'max-w-[80%] space-y-0.5 rounded-2xl px-3 py-2 text-sm leading-snug',
                        m.role === 'user'
                          ? 'rounded-bl-md border bg-card'
                          : 'rounded-br-md bg-primary text-primary-foreground'
                      )}
                    >
                      {m.nodeId === '__operator' && (
                        <div className="flex items-center gap-1 text-[10px] opacity-70">
                          <Headset className="h-3 w-3" /> оператор
                        </div>
                      )}
                      <div className="whitespace-pre-wrap">{m.text}</div>
                      <div className="text-right text-[9px] opacity-60">
                        {new Date(m.createdAt).toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  </div>
                ))}
                {messages.length === 0 && (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    <Bot className="mr-2 h-4 w-4" /> Нет сообщений
                  </div>
                )}
              </div>

              <form
                className="flex items-center gap-2 border-t bg-background p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendReply();
                }}
              >
                <Input
                  placeholder="Ответить как оператор…"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
                <Button
                  type="submit"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  disabled={sending || !reply.trim()}
                  aria-label="Отправить"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

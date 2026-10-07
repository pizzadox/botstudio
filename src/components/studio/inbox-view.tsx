'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Bot,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Globe,
  Headset,
  Inbox,
  Loader2,
  MessageCircle,
  MessagesSquare,
  MessageSquare,
  Search,
  Send,
  SearchCheck,
  Truck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/lib/client-api';
import type { ChatMessage, ConversationListItem } from '@/lib/studio-types';
import {
  ORDER_STATUS_BADGES,
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  SOURCE_COLORS,
  SOURCE_LABELS,
} from '@/lib/studio-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { MytkoBadge } from '@/components/studio/mytko-badge';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/** Dark-пары для цветных чипов источников (светлые классы приходят из SOURCE_COLORS) */
const SOURCE_DARK: Record<string, string> = {
  telegram: 'dark:bg-sky-500/15 dark:text-sky-300',
  whatsapp: 'dark:bg-emerald-500/15 dark:text-emerald-300',
  max: 'dark:bg-violet-500/15 dark:text-violet-300',
  web: 'dark:bg-amber-500/15 dark:text-amber-300',
  simulator: 'dark:bg-slate-500/15 dark:text-slate-300',
};

function sourceChipClass(source: string): string {
  return cn(
    SOURCE_COLORS[source] ?? 'bg-muted text-muted-foreground',
    SOURCE_DARK[source]
  );
}

/** Осмысленные пустые состояния для каждого фильтра списка */
const EMPTY_STATES: Record<'all' | 'operator' | 'unread' | 'closed', { title: string; hint: string }> = {
  all: {
    title: 'Диалогов пока нет',
    hint: 'Опубликуйте бота и напишите ему в демо-чате или мессенджере — обращения появятся здесь.',
  },
  operator: {
    title: 'Нет диалогов, требующих внимания',
    hint: 'Когда клиент попросит оператора, обращение появится в этом списке.',
  },
  unread: {
    title: 'Новых диалогов нет',
    hint: 'Непрочитанные обращения от клиентов будут собираться здесь.',
  },
  closed: {
    title: 'Закрытых обращений нет',
    hint: 'Завершённые диалоги сохраняются в этой категории.',
  },
};

const FILTER_ICONS: Record<'all' | 'operator' | 'unread' | 'closed', LucideIcon> = {
  all: MessagesSquare,
  operator: Headset,
  unread: MessageSquare,
  closed: Archive,
};

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

/** Пустое состояние: иконка в квадрате + заголовок + пояснение */
function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <div className="max-w-[280px]">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

/** Скелетон строки списка диалогов */
function ConversationRowSkeleton() {
  return (
    <div className="space-y-2 py-2.5" aria-hidden>
      <div className="flex items-center gap-2">
        <Skeleton className="h-3.5 w-14 rounded-full" />
        <Skeleton className="h-4 min-w-0 flex-1" />
        <Skeleton className="h-3 w-14" />
      </div>
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}

interface ConvOrder {
  id: string;
  number: number;
  type: string;
  status: string;
  address: string | null;
  city: string | null;
  size: string | null;
  wishDate: string | null;
  clientName: string | null;
  phone: string | null;
  assignee: string | null;
  mytkoStatus: string | null;
  mytkoInfo: string | null;
  mytkoSyncAt: string | null;
  createdAt: string;
}

/** Панель заявок клиента: просмотр и быстрое изменение статуса/исполнителя */
function ConversationOrdersPanel({
  conversationId,
  botId,
  refreshTick,
}: {
  conversationId: string;
  botId: string;
  refreshTick: number;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<ConvOrder[]>([]);
  const [mytkoEnabled, setMytkoEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ orders: ConvOrder[]; mytkoEnabled?: boolean }>(
        `/api/conversations/${conversationId}/orders`
      );
      setOrders(d.orders);
      setMytkoEnabled(!!d.mytkoEnabled);
    } catch {
      /* ignore */
    } finally {
      setLoaded(true);
    }
  }, [conversationId]);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  const patch = async (orderId: string, data: Record<string, unknown>) => {
    setSavingId(orderId);
    try {
      const d = await api<{ order: { status: string; assignee: string | null } }>(
        `/api/bots/${botId}/orders/${orderId}`,
        { method: 'PATCH', body: JSON.stringify(data) }
      );
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, status: d.order.status, assignee: d.order.assignee } : o
        )
      );
      toast({ title: 'Заявка обновлена' });
    } catch {
      toast({ title: 'Не удалось обновить заявку', variant: 'destructive' });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="border-b bg-background px-4 py-2">
      <button
        className="flex w-full items-center gap-1.5 rounded text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="conversation-orders-list"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Truck className="h-3.5 w-3.5" />
        Заявки клиента <span className="tabular-nums">({orders.length})</span>
      </button>
      <div id="conversation-orders-list">
        {open && loaded && orders.length > 0 && (
          <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {orders.map((o) => (
              <div key={o.id} className="rounded-lg border p-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-xs font-semibold tabular-nums">№{o.number}</span>
                  <Badge
                    variant="outline"
                    className={cn('h-4 px-1 text-[9px]', ORDER_STATUS_BADGES[o.status])}
                  >
                    {ORDER_STATUS_LABELS[o.status] ?? o.status}
                  </Badge>
                  {mytkoEnabled && <MytkoBadge status={o.mytkoStatus} />}
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {ORDER_TYPE_LABELS[o.type] ?? o.type}
                    {o.address ? ` · ${o.address}` : ''}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Select
                    value={o.status}
                    onValueChange={(v) => patch(o.id, { status: v })}
                    disabled={savingId === o.id}
                  >
                    <SelectTrigger className="h-7 w-[130px] text-[11px]" aria-label="Статус заявки">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k} className="text-xs">
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="h-7 w-[120px] flex-1 text-[11px] sm:w-[140px]"
                    defaultValue={o.assignee ?? ''}
                    placeholder="Исполнитель…"
                    aria-label="Исполнитель"
                    onBlur={(e) => {
                      if (e.target.value !== (o.assignee ?? '')) patch(o.id, { assignee: e.target.value });
                    }}
                  />
                  {o.wishDate && (
                    <span className="text-[11px] text-muted-foreground">🗓 {o.wishDate}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {open && loaded && orders.length === 0 && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">У клиента пока нет заявок.</p>
        )}
        {open && !loaded && (
          <div className="mt-2 space-y-1.5" role="status" aria-label="Загрузка заявок клиента">
            <Skeleton className="h-[52px] w-full rounded-lg" />
            <Skeleton className="h-[52px] w-full rounded-lg" />
          </div>
        )}
      </div>
    </div>
  );
}

export default function InboxView({
  bot,
  onBack,
  focusConversationId,
  onFocusConsumed,
}: {
  bot: { id: string; name: string };
  onBack: () => void;
  /** id диалога из уведомления — сразу открыть его */
  focusConversationId?: string | null;
  onFocusConsumed?: () => void;
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
  const [ordersTick, setOrdersTick] = useState(0);
  /** Фильтр списка: все / нужен оператор / новые / закрытые */
  const [filter, setFilter] = useState<'all' | 'operator' | 'unread' | 'closed'>('all');
  const [query, setQuery] = useState('');
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

  /** Открыть диалог: выделяем и сразу помечаем прочитанным (сервер запоминает operatorReadAt) */
  const openConversation = useCallback((id: string) => {
    setSelectedId(id);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: false } : c)));
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // Переход из уведомления: сразу открываем нужный диалог
  useEffect(() => {
    if (!focusConversationId) return;
    openConversation(focusConversationId);
    onFocusConsumed?.();
  }, [focusConversationId, openConversation, onFocusConsumed]);

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

  const operatorCount = useMemo(
    () => conversations.filter((c) => c.needsOperator && c.status === 'open').length,
    [conversations]
  );
  const unreadCount = useMemo(
    () => conversations.filter((c) => c.unread && c.status === 'open').length,
    [conversations]
  );
  const closedCount = useMemo(
    () => conversations.filter((c) => c.status === 'closed').length,
    [conversations]
  );

  /** Сортировка: нуждаются в операторе → непрочитанные → по времени; плюс поиск и фильтр */
  const visibleList = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = conversations.filter((c) => {
      if (filter === 'operator') return c.needsOperator && c.status === 'open';
      if (filter === 'unread') return c.unread && c.status === 'open';
      if (filter === 'closed') return c.status === 'closed';
      return true;
    });
    if (q) {
      list = list.filter(
        (c) =>
          (c.contact ?? '').toLowerCase().includes(q) ||
          (c.lastMessage?.text ?? '').toLowerCase().includes(q)
      );
    }
    const weight = (c: ConversationListItem) =>
      c.needsOperator && c.status === 'open' ? 0 : c.unread && c.status === 'open' ? 1 : 2;
    return [...list].sort((a, b) => {
      const w = weight(a) - weight(b);
      if (w !== 0) return w;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [conversations, filter, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b bg-background px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"
          onClick={onBack}
          aria-label="Назад"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Inbox className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          <h1 className="shrink-0 text-lg font-bold tracking-tight sm:text-2xl">Входящие</h1>
          <Badge variant="secondary" className="min-w-0 max-w-[110px] truncate sm:max-w-[180px]">
            {bot.name}
          </Badge>
          {operatorCount > 0 && (
            <Badge variant="destructive" className="shrink-0 animate-pulse tabular-nums">
              <Headset className="mr-1 h-3 w-3" />
              <span className="hidden sm:inline">оператор: </span>
              {operatorCount}
            </Badge>
          )}
          {unreadCount > 0 && (
            <Badge className="shrink-0 bg-primary/15 text-primary tabular-nums hover:bg-primary/15">
              <span className="hidden sm:inline">новые: </span>
              {unreadCount}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 md:grid-cols-[340px_1fr]">
        {/* Список диалогов */}
        <div className={cn('flex min-h-0 flex-col border-r', selected && 'hidden md:flex')}>
          {/* Фильтры: все / нужен оператор / новые / закрытые + поиск */}
          <div className="flex flex-wrap items-center gap-1.5 border-b bg-background px-2.5 py-2 sm:px-3">
            {(
              [
                { key: 'all', label: 'Все', count: conversations.length },
                { key: 'operator', label: 'Требуют внимания', count: operatorCount },
                { key: 'unread', label: 'Новые', count: unreadCount },
                { key: 'closed', label: 'Закрытые', count: closedCount },
              ] as const
            ).map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cn(
                  'h-8 rounded-full px-3 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  filter === f.key
                    ? 'border border-transparent bg-primary text-primary-foreground'
                    : 'border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {f.label}
                {f.count > 0 && (
                  <span className={cn('ml-1 tabular-nums', filter === f.key ? 'opacity-80' : 'opacity-60')}>
                    {f.count}
                  </span>
                )}
              </button>
            ))}
            <div className="relative ml-auto w-full sm:w-40">
              <Search
                className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                className="h-8 pl-7 text-xs"
                placeholder="Поиск по имени…"
                aria-label="Поиск диалогов"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          {loading ? (
            <div className="space-y-1 p-3" role="status" aria-label="Загрузка диалогов">
              {Array.from({ length: 7 }).map((_, i) => (
                <ConversationRowSkeleton key={i} />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={FILTER_ICONS.all}
              title={EMPTY_STATES.all.title}
              hint={EMPTY_STATES.all.hint}
            />
          ) : visibleList.length === 0 ? (
            query.trim() ? (
              <EmptyState
                icon={SearchCheck}
                title="Ничего не найдено"
                hint="Попробуйте изменить запрос или выбрать другой фильтр."
              />
            ) : (
              <EmptyState
                icon={FILTER_ICONS[filter]}
                title={EMPTY_STATES[filter].title}
                hint={EMPTY_STATES[filter].hint}
              />
            )
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="divide-y">
                {visibleList.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => openConversation(c.id)}
                    aria-current={selectedId === c.id ? 'true' : undefined}
                    className={cn(
                      'flex w-full min-w-0 flex-col gap-1 p-3 text-left transition-colors hover:bg-muted/60',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      selectedId === c.id && 'bg-primary/5',
                      c.unread && c.status === 'open' && 'bg-primary/[0.04]'
                    )}
                  >
                    <div className="flex min-w-0 w-full items-center gap-2">
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full transition-colors',
                          c.needsOperator && c.status === 'open' // красная точка важнее
                            ? 'bg-destructive'
                            : c.unread && c.status === 'open'
                              ? 'bg-primary'
                              : 'bg-transparent'
                        )}
                        aria-hidden
                      />
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                          sourceChipClass(c.source)
                        )}
                      >
                        <SourceIcon source={c.source} className="h-3 w-3" />
                        {SOURCE_LABELS[c.source] ?? c.source}
                      </span>
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-sm',
                          c.unread && c.status === 'open' ? 'font-semibold' : 'font-medium'
                        )}
                      >
                        {c.contact || 'Без имени'}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {timeAgo(c.updatedAt)}
                      </span>
                    </div>
                    <p className="min-w-0 w-full truncate text-xs text-muted-foreground">
                      {c.lastMessage
                        ? `${c.lastMessage.role === 'user' ? '' : 'Вы: '}${c.lastMessage.text}`
                        : 'Нет сообщений'}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {c.needsOperator && c.status === 'open' && (
                        <Badge variant="destructive" className="h-4 animate-pulse px-1.5 text-[9px]">
                          <Headset className="mr-0.5 h-2.5 w-2.5" /> требует внимания
                        </Badge>
                      )}
                      {c.unread && c.status === 'open' && (
                        <Badge className="h-4 bg-primary/15 px-1.5 text-[9px] text-primary hover:bg-primary/15">
                          новое
                        </Badge>
                      )}
                      {c.status === 'closed' && (
                        <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                          закрыт
                        </Badge>
                      )}
                      <Badge variant="outline" className="h-4 px-1.5 text-[9px] tabular-nums">
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
            <EmptyState
              icon={MessagesSquare}
              title="Выберите диалог"
              hint="Список обращений слева: клик откроет переписку и заявки клиента."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 md:hidden"
                  onClick={() => setSelectedId(null)}
                  aria-label="К списку диалогов"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    sourceChipClass(selectedSource)
                  )}
                >
                  <SourceIcon source={selectedSource} className="h-3 w-3" />
                  {SOURCE_LABELS[selectedSource] ?? selectedSource}
                </span>
                <span className="text-sm font-medium">{contact || 'Гость'}</span>
                {needsOperator && status === 'open' && (
                  <Badge variant="destructive" className="animate-pulse">
                    <Headset className="mr-1 h-3 w-3" /> требует внимания
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

              <ConversationOrdersPanel conversationId={selected.id} botId={bot.id} refreshTick={ordersTick} />

              <div
                ref={scrollRef}
                aria-live="polite"
                aria-label="История сообщений"
                className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/40 p-4"
              >
                {messages.map((m) => {
                  const isOperator = m.nodeId === '__operator';
                  return (
                    <div
                      key={m.id}
                      className={cn('flex min-w-0', m.role === 'user' ? 'justify-start' : 'justify-end')}
                    >
                      <div
                        className={cn(
                          'max-w-[85%] space-y-0.5 rounded-2xl px-3.5 py-2 text-sm leading-snug sm:max-w-[75%]',
                          m.role === 'user'
                            ? 'rounded-bl-md bg-muted'
                            : isOperator
                              ? 'rounded-br-md bg-primary text-primary-foreground'
                              : 'rounded-br-md border bg-card'
                        )}
                      >
                        {isOperator && (
                          <div className="flex items-center gap-1 text-[10px] opacity-80">
                            <Headset className="h-3 w-3" /> оператор
                          </div>
                        )}
                        <div className="whitespace-pre-wrap">{m.text}</div>
                        <div
                          className={cn(
                            'text-right text-[10px]',
                            isOperator ? 'text-primary-foreground/70' : 'text-muted-foreground'
                          )}
                        >
                          {new Date(m.createdAt).toLocaleTimeString('ru-RU', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Bot className="h-6 w-6" aria-hidden />
                    </div>
                    <p className="text-sm font-medium text-foreground">Сообщений пока нет</p>
                    <p className="max-w-[260px] text-sm text-muted-foreground">
                      Ответьте клиенту — сообщение появится в этой переписке.
                    </p>
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
                  aria-label="Ответить как оператор"
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

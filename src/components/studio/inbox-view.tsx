'use client';

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Archive,
  Bot,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Clock,
  Copy,
  Globe,
  Headset,
  Inbox,
  Loader2,
  MessageCircle,
  MessagesSquare,
  MessageSquare,
  MoreHorizontal,
  Pin,
  PinOff,
  RotateCcw,
  Search,
  Send,
  SearchCheck,
  Truck,
  WifiOff,
  XCircle,
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
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

/** Ключи localStorage для persistence фильтра и поиска инбокса (IMP-F07) */
const LS_FILTER_KEY = 'bstudio.inbox.filter';
const LS_QUERY_KEY = 'bstudio.inbox.q';

type FilterKey = 'all' | 'operator' | 'unread' | 'closed';

const FILTER_KEYS: FilterKey[] = ['all', 'operator', 'unread', 'closed'];

/** SSR-безопасное чтение localStorage (на сервере/в приватном режиме — fallback) */
function readLS(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* localStorage недоступен — не критично */
  }
}

/**
 * Дедуп-слияние сообщений поллинга (IMP-F03): добавляем только новые id,
 * сортируем по createdAt. Если ничего нового — возвращаем prev как есть
 * (ссылочная стабильность убирает лишние ре-рендеры).
 */
function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Set(prev.map((m) => m.id));
  const add = incoming.filter((m) => !seen.has(m.id));
  if (!add.length) return prev;
  return [...prev, ...add].sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
}

/** Осмысленные пустые состояния для каждого фильтра списка */
const EMPTY_STATES: Record<FilterKey, { title: string; hint: string }> = {
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

const FILTER_ICONS: Record<FilterKey, LucideIcon> = {
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

/**
 * Строка списка диалогов (IMP-F09): memo + только примитивные props
 * и стабильный колбэк — при поллинге перерисовываются только изменившиеся строки.
 */
interface ConversationRowProps {
  id: string;
  source: string;
  contact: string | null;
  needsOperator: boolean;
  status: string;
  unread: boolean;
  pinned: boolean;
  messagesCount: number;
  updatedAt: string;
  lastMessageText: string | null;
  lastMessageRole: string | null;
  selected: boolean;
  onSelect: (id: string) => void;
}

const ConversationRow = memo(function ConversationRow({
  id,
  source,
  contact,
  needsOperator,
  status,
  unread,
  pinned,
  messagesCount,
  updatedAt,
  lastMessageText,
  lastMessageRole,
  selected,
  onSelect,
}: ConversationRowProps) {
  return (
    <button
      type="button"
      data-conv-id={id}
      onClick={() => onSelect(id)}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex w-full min-w-0 flex-col gap-1 py-3 pl-3 pr-12 text-left transition-colors hover:bg-muted/60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        selected && 'bg-primary/5',
        unread && status === 'open' && 'bg-primary/[0.04]'
      )}
    >
      <div className="flex min-w-0 w-full items-center gap-2">
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full transition-colors',
            needsOperator && status === 'open' // красная точка важнее
              ? 'bg-destructive'
              : unread && status === 'open'
                ? 'bg-primary'
                : 'bg-transparent'
          )}
          aria-hidden
        />
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
            sourceChipClass(source)
          )}
        >
          <SourceIcon source={source} className="h-3 w-3" />
          {SOURCE_LABELS[source] ?? source}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            unread && status === 'open' ? 'font-semibold' : 'font-medium'
          )}
        >
          {contact || 'Без имени'}
        </span>
        {/* IMP-F05: относительное время + полная дата/время в title */}
        <span
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
          title={new Date(updatedAt).toLocaleString('ru-RU')}
        >
          {timeAgo(updatedAt)}
        </span>
      </div>
      <p className="min-w-0 w-full truncate text-xs text-muted-foreground">
        {lastMessageText !== null
          ? `${lastMessageRole === 'user' ? '' : 'Вы: '}${lastMessageText}`
          : 'Нет сообщений'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {pinned && (
          <Badge
            variant="outline"
            className="h-4 gap-0.5 px-1.5 text-[9px]"
            title="Диалог закреплён"
          >
            <Pin className="h-2.5 w-2.5" aria-hidden /> закреплён
          </Badge>
        )}
        {needsOperator && status === 'open' && (
          <Badge variant="destructive" className="h-4 animate-pulse px-1.5 text-[9px]">
            <Headset className="mr-0.5 h-2.5 w-2.5" /> требует внимания
          </Badge>
        )}
        {unread && status === 'open' && (
          <Badge className="h-4 bg-primary/15 px-1.5 text-[9px] text-primary hover:bg-primary/15">
            новое
          </Badge>
        )}
        {status === 'closed' && (
          <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
            закрыт
          </Badge>
        )}
        <Badge variant="outline" className="h-4 px-1.5 text-[9px] tabular-nums">
          {messagesCount} сообщ.
        </Badge>
      </div>
    </button>
  );
});

/** FE22-25: контекстное меню строки диалога — закрепить / копировать / закрыть.
 *  Триггер «…» — отдельный элемент поверх строки (строка кликабельна целиком,
 *  stopPropagation не даёт открыть диалог при клике по меню). */
interface ConversationRowMenuProps {
  convId: string;
  contact: string | null;
  pinned: boolean;
  status: string;
  onPin: (convId: string, pinned: boolean) => void;
  onCopyContact: (contact: string | null) => void;
  onCopyTranscript: (convId: string, contact: string | null) => void;
  onCloseRequest: (convId: string, contact: string | null) => void;
}

const ConversationRowMenu = memo(function ConversationRowMenu({
  convId,
  contact,
  pinned,
  status,
  onPin,
  onCopyContact,
  onCopyTranscript,
  onCloseRequest,
}: ConversationRowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Действия с диалогом: ${contact || 'гость'}`}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0.5 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => onPin(convId, pinned)}>
          {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          {pinned ? 'Открепить' : 'Закрепить'}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!contact} onSelect={() => onCopyContact(contact)}>
          <Copy className="h-4 w-4" /> Копировать контакт
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCopyTranscript(convId, contact)}>
          <ClipboardCopy className="h-4 w-4" /> Скопировать переписку
        </DropdownMenuItem>
        {status === 'open' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onCloseRequest(convId, contact)}
            >
              <XCircle className="h-4 w-4" /> Закрыть обращение
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

/** Пузырь реального сообщения (memo: ссылка стабильна благодаря дедуп-слиянию) */
const MessageBubble = memo(function MessageBubble({ m }: { m: ChatMessage }) {
  const isOperator = m.nodeId === '__operator';
  return (
    <div className={cn('flex min-w-0', m.role === 'user' ? 'justify-start' : 'justify-end')}>
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
});

/** Оптимистичный пузырь ответа оператора (IMP-F02): отправляется / ошибка */
interface OptimisticMessage {
  id: string;
  convId: string;
  text: string;
  status: 'sending' | 'error';
}

function OptimisticBubble({
  msg,
  onRetry,
}: {
  msg: OptimisticMessage;
  onRetry: (id: string) => void;
}) {
  const isError = msg.status === 'error';
  return (
    <div className="flex min-w-0 justify-end">
      <div
        className={cn(
          'max-w-[85%] space-y-0.5 rounded-2xl rounded-br-md px-3.5 py-2 text-sm leading-snug sm:max-w-[75%]',
          isError
            ? 'border border-destructive/40 bg-destructive/10 text-foreground'
            : 'bg-primary text-primary-foreground opacity-70'
        )}
      >
        <div className="whitespace-pre-wrap">{msg.text}</div>
        <div className="flex items-center justify-end gap-1.5 text-[10px]">
          {isError ? (
            <>
              <span className="font-medium text-destructive">Не отправлено</span>
              <button
                type="button"
                onClick={() => onRetry(msg.id)}
                aria-label={`Повторить отправку: ${msg.text.slice(0, 50)}`}
                className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium text-destructive underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RotateCcw className="h-3 w-3" aria-hidden /> Повторить
              </button>
            </>
          ) : (
            <span
              className="inline-flex items-center gap-1 text-primary-foreground/70"
              aria-hidden
            >
              <Clock className="h-3 w-3" /> отправляется…
            </span>
          )}
        </div>
      </div>
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
  /** FE22-25: API возвращает pinned/pinnedAt (закреплённые сверху) — расширяем локально */
  type ConvRow = ConversationListItem & { pinned?: boolean };
  const [conversations, setConversations] = useState<ConvRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);
  const [contact, setContact] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState('web');
  const [needsOperator, setNeedsOperator] = useState(false);
  const [status, setStatus] = useState('open');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [ordersTick, setOrdersTick] = useState(0);
  /** Фильтр списка: все / нужен оператор / новые / закрытые (persist в localStorage) */
  const [filter, setFilter] = useState<FilterKey>(() => {
    const v = readLS(LS_FILTER_KEY, 'all');
    return FILTER_KEYS.includes(v as FilterKey) ? (v as FilterKey) : 'all';
  });
  const [query, setQuery] = useState(() => readLS(LS_QUERY_KEY, ''));
  /** Свежесть данных (IMP-F08) */
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [failStreak, setFailStreak] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** FE22-24: auto-grow textarea ответа (до 4 строк) */
  const replyTaRef = useRef<HTMLTextAreaElement>(null);
  /** IMP-F01: пользователь у дна переписки? — иначе не таскаем его вниз */
  const isNearBottomRef = useRef(true);
  /** Свежие ссылки для стабильных подписчиков (клавиатура/поллинг без ре-монтажа) */
  const selectedIdRef = useRef<string | null>(null);
  const visibleListRef = useRef<ConversationListItem[]>([]);
  /** Зеркало messages для «Скопировать переписку» без зависимостей колбэка (FE22-25) */
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /** FE22-24: черновики ответов per-диалог — Map в state + persist в localStorage.
   *  Переключение диалогов сохраняет тексты, отправка — очищает. */
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const reply = selectedId ? (drafts.get(selectedId) ?? '') : '';
  const setReply = useCallback((text: string) => {
    const id = selectedIdRef.current;
    if (!id) return;
    setDrafts((prev) => {
      if (prev.get(id) === text) return prev;
      const next = new Map(prev);
      next.set(id, text);
      return next;
    });
  }, []);

  // FE22-24: debounce-запись черновиков в localStorage (bstudio.inbox.draft.<convId>)
  useEffect(() => {
    if (drafts.size === 0) return;
    const t = setTimeout(() => {
      drafts.forEach((text, id) => writeLS(`bstudio.inbox.draft.${id}`, text));
    }, 400);
    return () => clearTimeout(t);
  }, [drafts]);

  // FE22-24: auto-grow до 4 строк (fallback для браузеров без field-sizing);
  // сброс высоты при очистке (отправка/переключение диалога)
  useEffect(() => {
    const el = replyTaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 98)}px`;
  }, [reply]);

  // IMP-F07: persist фильтра и поиска
  useEffect(() => {
    writeLS(LS_FILTER_KEY, filter);
  }, [filter]);

  useEffect(() => {
    writeLS(LS_QUERY_KEY, query);
  }, [query]);

  const notePollSuccess = useCallback(() => {
    setFailStreak(0);
    setLastSyncAt(new Date());
  }, []);

  const notePollFailure = useCallback(() => {
    setFailStreak((s) => s + 1);
  }, []);

  const loadList = useCallback(async () => {
    try {
      const d = await api<{ conversations: ConvRow[] }>(
        `/api/bots/${bot.id}/conversations`
      );
      setConversations(d.conversations);
      notePollSuccess();
    } catch {
      notePollFailure();
      /* ignore polling errors */
    } finally {
      setLoading(false);
    }
  }, [bot.id, notePollSuccess, notePollFailure]);

  /** Первая загрузка диалога — полная, без take (IMP-F03) */
  const loadConversationFull = useCallback(
    async (id: string) => {
      try {
        const d = await api<{
          conversation: { contact: string | null; source: string; needsOperator: boolean; status: string };
          messages: ChatMessage[];
        }>(`/api/conversations/${id}`);
        notePollSuccess();
        // Диалог могли переключить, пока летел ответ
        if (selectedIdRef.current !== id) return;
        setMessages(d.messages);
        setContact(d.conversation.contact);
        setSelectedSource(d.conversation.source);
        setNeedsOperator(d.conversation.needsOperator);
        setStatus(d.conversation.status);
        isNearBottomRef.current = true; // новая переписка — стартуем снизу
      } catch {
        notePollFailure();
      }
    },
    [notePollSuccess, notePollFailure]
  );

  /** Фоновый поллинг диалога — ?take=50 + дедуп-слияние (IMP-F03) */
  const pollConversation = useCallback(
    async (id: string) => {
      try {
        const d = await api<{
          conversation: { contact: string | null; source: string; needsOperator: boolean; status: string };
          messages: ChatMessage[];
        }>(`/api/conversations/${id}?take=50`);
        notePollSuccess();
        if (selectedIdRef.current !== id) return;
        setMessages((prev) => mergeMessages(prev, d.messages));
        setContact(d.conversation.contact);
        setSelectedSource(d.conversation.source);
        setNeedsOperator(d.conversation.needsOperator);
        setStatus(d.conversation.status);
      } catch {
        notePollFailure();
      }
    },
    [notePollSuccess, notePollFailure]
  );

  /** Открыть диалог: выделяем, помечаем прочитанным (сервер запоминает operatorReadAt)
   *  и подтягиваем сохранённый черновик этого диалога (FE22-24) */
  const openConversation = useCallback((id: string) => {
    setSelectedId(id);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: false } : c)));
    setDrafts((prev) => {
      if (prev.has(id)) return prev;
      const stored = readLS(`bstudio.inbox.draft.${id}`, '');
      if (!stored) return prev;
      const next = new Map(prev);
      next.set(id, stored);
      return next;
    });
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

  // Поллинг списка: 6с, пауза на document.hidden (IMP-F08)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(loadList, 6000);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        loadList();
        start();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadList]);

  // Поллинг открытого диалога: 4с, полная загрузка при открытии, пауза на document.hidden
  useEffect(() => {
    if (!selectedId) return;
    loadConversationFull(selectedId);
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => pollConversation(selectedId);
    const start = () => {
      if (timer === null) timer = setInterval(tick, 4000);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        tick();
        start();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [selectedId, loadConversationFull, pollConversation]);

  // IMP-F01: скроллим вниз только когда пользователь у дна (±120px)
  const onMessagesScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const pendingForSelected = useMemo(
    () => optimistic.filter((o) => o.convId === selectedId),
    [optimistic, selectedId]
  );

  useEffect(() => {
    if (!isNearBottomRef.current) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, [messages, pendingForSelected.length]);

  /** Доставка ответа оператора (используется и при повторной отправке) */
  const deliverReply = useCallback(
    async (convId: string, tmpId: string, text: string) => {
      try {
        const d = await api<{ message: ChatMessage }>(`/api/conversations/${convId}/operator`, {
          method: 'POST',
          body: JSON.stringify({ text }),
        });
        // tmp удаляем, реальное сообщение вливаем дедуп-слиянием (поллинг его не продублирует)
        setOptimistic((prev) => prev.filter((o) => o.id !== tmpId));
        if (selectedIdRef.current === convId) {
          setMessages((prev) => mergeMessages(prev, [d.message]));
        }
      } catch {
        // Текст НИКОГДА не теряется: пузырь переходит в error-состояние с «Повторить»
        setOptimistic((prev) =>
          prev.map((o) => (o.id === tmpId ? { ...o, status: 'error' as const } : o))
        );
        toast({ title: 'Не удалось отправить', variant: 'destructive' });
      }
    },
    [toast]
  );

  const sendReply = async () => {
    const t = reply.trim();
    if (!t || !selectedId) return;
    const convId = selectedId;
    const tmpId = `tmp-${Date.now()}`;
    setOptimistic((prev) => [...prev, { id: tmpId, convId, text: t, status: 'sending' }]);
    // FE22-24: черновик отправлен — очищаем и в state, и в localStorage
    setDrafts((prev) => {
      if (!prev.has(convId)) return prev;
      const next = new Map(prev);
      next.delete(convId);
      return next;
    });
    writeLS(`bstudio.inbox.draft.${convId}`, '');
    setSending(true);
    await deliverReply(convId, tmpId, t);
    setSending(false);
  };

  /** Повторная отправка тем же текстом (IMP-F02) */
  const retryReply = (tmpId: string) => {
    const msg = optimistic.find((o) => o.id === tmpId);
    if (!msg || msg.status === 'sending') return;
    setOptimistic((prev) =>
      prev.map((o) => (o.id === tmpId ? { ...o, status: 'sending' as const } : o))
    );
    void deliverReply(msg.convId, tmpId, msg.text);
  };

  /** FE22-25: закрытие обращения по id — из шапки (любой открытый диалог)
   *  или из контекстного меню строки; подтверждение — в AlertDialog */
  const [closeTarget, setCloseTarget] = useState<{ id: string; contact: string | null } | null>(
    null
  );
  const [closingBusy, setClosingBusy] = useState(false);

  const requestClose = useCallback((id: string, contactName: string | null) => {
    setCloseTarget({ id, contact: contactName });
  }, []);

  const closeById = async (id: string) => {
    setClosingBusy(true);
    try {
      await api(`/api/conversations/${id}/close`, { method: 'POST' });
      if (selectedIdRef.current === id) {
        setNeedsOperator(false);
        setStatus('closed');
      }
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: 'closed', needsOperator: false } : c))
      );
      setCloseTarget(null);
      toast({ title: 'Обращение закрыто' });
      loadList();
    } catch {
      toast({ title: 'Ошибка', variant: 'destructive' });
    } finally {
      setClosingBusy(false);
    }
  };

  /** FE22-25: закрепить/открепить — оптимистично, при ошибке откат */
  const togglePin = useCallback(
    async (convId: string, pinned: boolean) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, pinned: !pinned } : c))
      );
      try {
        await api(`/api/bots/${bot.id}/conversations/${convId}/pin`, {
          method: 'POST',
          body: JSON.stringify({ pinned: !pinned }),
        });
        toast({ title: pinned ? 'Диалог откреплён' : 'Диалог закреплён' });
        loadList(); // подтверждаем порядок списка (закреплённые сверху)
      } catch {
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, pinned } : c))
        );
        toast({ title: 'Не удалось изменить закрепление', variant: 'destructive' });
      }
    },
    [bot.id, toast, loadList]
  );

  /** FE22-25: копирование контакта (паттерн CopyButton) */
  const copyContact = useCallback(
    async (contactName: string | null) => {
      if (!contactName) return;
      try {
        await navigator.clipboard.writeText(contactName);
        toast({ title: 'Скопировано: контакт' });
      } catch {
        toast({ title: 'Не удалось скопировать', variant: 'destructive' });
      }
    },
    [toast]
  );

  /** FE22-25: переписка текстом «Кто: сообщение» — из загруженных сообщений
   *  открытого диалога, иначе точечный запрос */
  const copyTranscript = useCallback(
    async (convId: string, contactName: string | null) => {
      let msgs: ChatMessage[] | null = null;
      if (convId === selectedIdRef.current && messagesRef.current.length > 0) {
        msgs = messagesRef.current;
      } else {
        try {
          const d = await api<{ messages: ChatMessage[] }>(`/api/conversations/${convId}`);
          msgs = d.messages;
        } catch {
          toast({ title: 'Не удалось загрузить переписку', variant: 'destructive' });
          return;
        }
      }
      if (!msgs || msgs.length === 0) {
        toast({ title: 'Переписка пуста' });
        return;
      }
      const who = (m: ChatMessage) =>
        m.role === 'user' ? contactName || 'Клиент' : m.nodeId === '__operator' ? 'Оператор' : 'Бот';
      const text = msgs.map((m) => `${who(m)}: ${m.text}`).join('\n');
      try {
        await navigator.clipboard.writeText(text);
        toast({ title: `Скопировано: ${msgs.length} сообщ.` });
      } catch {
        toast({ title: 'Не удалось скопировать', variant: 'destructive' });
      }
    },
    [toast]
  );

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

  // IMP-F06: инпут мгновенный, фильтрация — по отложенному значению
  const deferredQuery = useDeferredValue(query);

  /** Сортировка: нуждаются в операторе → непрочитанные → по времени; плюс поиск и фильтр */
  const visibleList = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
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
    const weight = (c: ConvRow) =>
      c.pinned // закреплённые — всегда сверху (синхронно с orderBy сервера)
        ? -1
        : c.needsOperator && c.status === 'open'
          ? 0
          : c.unread && c.status === 'open'
            ? 1
            : 2;
    return [...list].sort((a, b) => {
      const w = weight(a) - weight(b);
      if (w !== 0) return w;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [conversations, filter, deferredQuery]);

  useEffect(() => {
    visibleListRef.current = visibleList;
  }, [visibleList]);

  // IMP-F04: клавиатура ↑/↓ — навигация по отфильтрованному списку диалогов с wrap
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return;
      }
      const list = visibleListRef.current;
      if (!list.length) return;
      e.preventDefault();
      const cur = list.findIndex((c) => c.id === selectedIdRef.current);
      const nextIdx =
        e.key === 'ArrowDown'
          ? (cur + 1 + list.length) % list.length
          : cur <= 0
            ? list.length - 1
            : cur - 1;
      const next = list[nextIdx];
      if (!next) return;
      openConversation(next.id);
      document
        .querySelector<HTMLElement>(`[data-conv-id="${CSS.escape(next.id)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openConversation]);

  // IMP-F08: «обновлено N с назад» — пересчитывается на каждом тике поллинга
  const syncSecondsAgo = lastSyncAt
    ? Math.max(0, Math.round((Date.now() - lastSyncAt.getTime()) / 1000))
    : null;

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
          {syncSecondsAgo !== null && (
            <span
              role="status"
              title={lastSyncAt ? lastSyncAt.toLocaleString('ru-RU') : undefined}
              className="ml-auto hidden shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-flex"
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  failStreak >= 3 ? 'bg-destructive' : 'bg-emerald-500'
                )}
                aria-hidden
              />
              обновлено <span className="tabular-nums">{syncSecondsAgo}</span> с назад
            </span>
          )}
        </div>
      </div>

      {failStreak >= 3 && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300"
        >
          <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Нет связи с сервера — повторяем попытку…
        </div>
      )}

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
            deferredQuery.trim() ? (
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
                  <div key={c.id} className="relative">
                    <ConversationRow
                      id={c.id}
                      source={c.source}
                      contact={c.contact}
                      needsOperator={c.needsOperator}
                      status={c.status}
                      unread={c.unread}
                      pinned={!!c.pinned}
                      messagesCount={c.messagesCount}
                      updatedAt={c.updatedAt}
                      lastMessageText={c.lastMessage?.text ?? null}
                      lastMessageRole={c.lastMessage?.role ?? null}
                      selected={selectedId === c.id}
                      onSelect={openConversation}
                    />
                    <ConversationRowMenu
                      convId={c.id}
                      contact={c.contact}
                      pinned={!!c.pinned}
                      status={c.status}
                      onPin={togglePin}
                      onCopyContact={copyContact}
                      onCopyTranscript={copyTranscript}
                      onCloseRequest={requestClose}
                    />
                  </div>
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
                  {/* FE22-25: закрыть можно ЛЮБОЙ открытый диалог (не только needsOperator);
                      подтверждение — общий AlertDialog */}
                  {status === 'open' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCloseTarget({ id: selected.id, contact })}
                    >
                      <XCircle className="h-3.5 w-3.5" /> Закрыть обращение
                    </Button>
                  )}
                </div>
              </div>

              <ConversationOrdersPanel conversationId={selected.id} botId={bot.id} refreshTick={ordersTick} />

              <div
                ref={scrollRef}
                onScroll={onMessagesScroll}
                aria-live="polite"
                aria-label="История сообщений"
                className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/40 p-4"
              >
                {messages.map((m) => (
                  <MessageBubble key={m.id} m={m} />
                ))}
                {pendingForSelected.map((o) => (
                  <OptimisticBubble key={o.id} msg={o} onRetry={retryReply} />
                ))}
                {messages.length === 0 && pendingForSelected.length === 0 && (
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
                className="flex items-end gap-2 border-t bg-background p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendReply();
                }}
              >
                {/* FE22-24: многострочный ответ — Enter отправляет, Shift+Enter переносит,
                    auto-grow до 4 строк */}
                <Textarea
                  ref={replyTaRef}
                  rows={1}
                  aria-label="Ответ клиенту"
                  placeholder="Ответить как оператор…"
                  value={reply}
                  className="min-h-[40px] max-h-[98px] resize-none py-2 text-sm"
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      sendReply();
                    }
                  }}
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

      {/* FE22-25: подтверждение закрытия обращения — из шапки и из контекстного меню */}
      <AlertDialog
        open={!!closeTarget}
        onOpenChange={(o) => {
          if (!o && !closingBusy) setCloseTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Закрыть обращение?</AlertDialogTitle>
            <AlertDialogDescription>
              Обращение{closeTarget?.contact ? ` с «${closeTarget.contact}»` : ''} будет закрыто —
              управление вернётся боту, клиент получит сообщение главного меню.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closingBusy}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60"
              disabled={closingBusy}
              onClick={(e) => {
                e.preventDefault(); // не закрываем диалог — ждём ответ сервера (busy виден)
                if (closeTarget) closeById(closeTarget.id);
              }}
            >
              {closingBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Закрыть обращение
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

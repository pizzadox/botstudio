'use client';

// IMP-23-TAB-03: вкладка «Обращения» — жалобы клиентов из ветки сценария бота
// (source=scenario) и добавленные оператором вручную (source=manual).
// Паттерны: inbox-view.tsx (список + поллинг 8 с, пауза при document.hidden,
// memo-карточки) и channels-view.tsx (формы/диалоги). API-контракт: волна 23.
// IMP-24-FE2: адрес/координаты инцидента, inline-правка адреса и совмещение
// с КП реестра (GET area-match → PATCH {areaLkCode} / PATCH {address}).
// IMP-25-FE2: merge-пагинация (поллинг не схлопывает «Показать ещё»), тосты
// ошибок патча, гео-контроль (перегеокодировать/копия координат) и эскалация
// жалобы в заявку (POST /orders + PATCH {orderId}).

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  CircleAlert,
  Copy,
  Loader2,
  MapPin,
  MapPinned,
  MessageCircleWarning,
  MessagesSquare,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Truck,
  Unlink,
  User,
  WifiOff,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/lib/client-api';
import type {
  AreaMatchCandidate,
  ComplaintCounts,
  ComplaintDto,
} from '@/lib/studio-types';
import {
  COMPLAINT_SOURCE_BADGES,
  COMPLAINT_SOURCE_LABELS,
  COMPLAINT_STATUS_BADGES,
  COMPLAINT_STATUS_LABELS,
  COMPLAINT_TYPE_LABELS,
  complaintCountKey,
} from '@/lib/studio-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const TAKE = 50;

type StatusFilter = 'all' | 'new' | 'in_review' | 'resolved';
const STATUS_FILTERS: StatusFilter[] = ['all', 'new', 'in_review', 'resolved'];

/** Скелетон карточки обращения */
function ComplaintCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4" aria-hidden>
      <div className="flex flex-wrap items-center gap-1.5">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-28 rounded-full" />
        <Skeleton className="h-4 w-16 rounded-full" />
        <Skeleton className="ml-auto h-3 w-24" />
      </div>
      <Skeleton className="mt-2.5 h-3.5 w-full" />
      <Skeleton className="mt-1.5 h-3.5 w-2/3" />
    </div>
  );
}

/** Пустое состояние: иконка в квадрате + заголовок + пояснение (как в inbox-view) */
function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <div className="max-w-[300px]">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

/** Дата-время по русски (tabular-nums рендерится снаружи) */
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Когда произошло: date-input даёт 'YYYY-MM-DD' (UTC-парсинг сдвинул бы сутки) */
function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}.${m[2]}.${m[1].slice(2)}`;
  return new Date(iso).toLocaleDateString('ru-RU');
}

/** Координаты текстом: «58.52260, 31.27000» (как в areas-view) */
function fmtCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** Длинное описание? — показываем «показать полностью» */
function isLong(description: string): boolean {
  return description.length > 140 || description.split('\n').length > 3;
}

/** IMP-25-23: порядок бэка — createdAt desc, тайбрейк id desc (merge не ломает сортировку) */
function cmpServerOrder(a: ComplaintDto, b: ComplaintDto): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

/** IMP-24-FE2: поля жалобы, меняемые из карточки через PATCH (статус — через changeStatus) */
type ComplaintPatch = Partial<Pick<ComplaintDto, 'address' | 'areaLkCode'>>;

interface ComplaintCardProps {
  complaint: ComplaintDto;
  botId: string;
  saving: boolean;
  /** IMP-25-26: идёт эскалация этой карточки (POST заявки + PATCH {orderId}) */
  escalating: boolean;
  /** IMP-25-26: номер заявки, созданной из жалобы в этой сессии (DTO несёт только orderId) */
  orderNumber?: number;
  onStatusChange: (complaint: ComplaintDto, status: string) => void;
  onShowFull: (complaint: ComplaintDto) => void;
  /** IMP-24-FE2-04: оптимистичный PATCH адреса/КП с откатом; true — успех */
  onPatch: (
    complaint: ComplaintDto,
    patch: ComplaintPatch,
    successTitle: string
  ) => Promise<boolean>;
  /** IMP-25-25: PATCH {geocode:true}; true — успех */
  onGeocode: (complaint: ComplaintDto) => Promise<boolean>;
  /** IMP-25-26: POST /orders из жалобы + PATCH {orderId}; true — успех */
  onEscalate: (complaint: ComplaintDto) => Promise<boolean>;
}

/**
 * Карточка обращения (memo): при поллинге перерисовываются только изменившиеся.
 * Статус меняется чипами (оптимистично), при conversationId — кнопка «Открыть диалог».
 * IMP-24-FE2: inline-редактор адреса и блок «Совместить с КП» (area-match).
 */
const ComplaintCard = memo(function ComplaintCard({
  complaint,
  botId,
  saving,
  escalating,
  orderNumber,
  onStatusChange,
  onShowFull,
  onPatch,
  onGeocode,
  onEscalate,
}: ComplaintCardProps) {
  const { toast } = useToast();
  // IMP-24-FE2-03: inline-редактор адреса (без модального окна)
  const [editAddr, setEditAddr] = useState(false);
  const [addrDraft, setAddrDraft] = useState('');
  // IMP-25-25: одноразовый хинт «точка пересчитана по новому адресу»
  const [geoHint, setGeoHint] = useState(false);
  // IMP-24-FE2-02: блок «КП рядом…» — один GET area-match на каждое открытие
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState(false);
  const [match, setMatch] = useState<AreaMatchCandidate[] | null>(null);

  const openConversation = () => {
    if (!complaint.conversationId) return;
    // Тот же канал, что и кнопка «Открыть диалог» в карточке заявки (FE22-05):
    // слушатель в app-root открывает инбокс с фокусом на переписке.
    window.dispatchEvent(
      new CustomEvent('bstudio:open-conversation', {
        detail: { conversationId: complaint.conversationId },
      })
    );
  };

  // IMP-24-FE2-03: сохранить адрес через общий оптимистичный PATCH (IMP-24-FE2-04)
  const saveAddress = async () => {
    const address = addrDraft.trim();
    if (!address || address === complaint.address) return;
    // IMP-25-25: если точка уже была — бэк (25-BE2) пересчитает её по новому
    // адресу автоматически; показываем одноразовый хинт после успеха
    const hadCoords = complaint.lat != null && complaint.lng != null;
    const ok = await onPatch(complaint, { address }, 'Адрес обновлён');
    if (ok) {
      setEditAddr(false);
      setGeoHint(hadCoords);
    }
  };

  const openAddressEditor = useCallback(() => {
    setAddrDraft(complaint.address ?? '');
    setMatchOpen(false);
    setGeoHint(false);
    setEditAddr(true);
  }, [complaint.address]);

  // IMP-25-25: координаты — компактно и с копированием (как в заявках)
  const copyCoords = async () => {
    if (complaint.lat == null || complaint.lng == null) return;
    try {
      await navigator.clipboard.writeText(fmtCoords(complaint.lat, complaint.lng));
      toast({ title: 'Скопировано: координаты' });
    } catch {
      toast({ title: 'Не удалось скопировать', variant: 'destructive' });
    }
  };

  // IMP-25-25: перегеокодировать — бэк пересчитает точку по текущему адресу
  const regeocode = async () => {
    const ok = await onGeocode(complaint);
    if (ok) setGeoHint(false);
  };

  // IMP-25-26: чип «Заявка №N» — переход в раздел «Заявки» (слушатель в app-root)
  const openOrders = () => {
    window.dispatchEvent(new CustomEvent('bstudio:open-orders'));
  };

  // IMP-24-FE2-02: кандидаты на совмещение — GET area-match, один запрос на открытие
  const matchAbortRef = useRef<AbortController | null>(null);
  const loadMatch = useCallback(async () => {
    // IMP-24-REV-7: отмена предыдущего запроса — без гонок и моргающего лоадера
    matchAbortRef.current?.abort();
    const ac = new AbortController();
    matchAbortRef.current = ac;
    setMatchLoading(true);
    setMatchError(false);
    try {
      const d = await api<{ candidates: AreaMatchCandidate[] }>(
        `/api/bots/${botId}/complaints/${complaint.id}/area-match`,
        { signal: ac.signal }
      );
      if (!ac.signal.aborted) setMatch(d.candidates ?? []);
    } catch {
      if (!ac.signal.aborted) setMatchError(true);
    } finally {
      if (!ac.signal.aborted) setMatchLoading(false);
    }
  }, [botId, complaint.id]);

  // IMP-24-REV-7: размонтирование карточки — отменяем висящий запрос
  useEffect(() => () => matchAbortRef.current?.abort(), []);

  const toggleMatch = () => {
    if (matchOpen) {
      setMatchOpen(false);
      return;
    }
    setMatch(null);
    setMatchError(false);
    setMatchOpen(true);
    void loadMatch();
  };

  // Привязка/отвязка меняют areaLkCode — раскрытый блок сбрасывается эффектом ниже.
  // IMP-25-24: результат патча обрабатывается — все фейлы (включая «занято»)
  // patchComplaint показывает тостом с причиной, тихих фейлов больше нет
  const linkArea = async (lk: string) => {
    await onPatch(complaint, { areaLkCode: lk }, `Жалоба совмещена с КП ${lk}`);
  };
  const unlinkArea = async () => {
    await onPatch(complaint, { areaLkCode: null }, 'Жалоба отвязана от КП');
  };

  // IMP-24-FE2-02: адрес/привязка изменились (свой PATCH, поллинг, другой клиент) —
  // кэш совпадений и открытый редактор больше не актуальны
  const matchKeyRef = useRef(`${complaint.address ?? ''}|${complaint.areaLkCode ?? ''}`);
  useEffect(() => {
    const key = `${complaint.address ?? ''}|${complaint.areaLkCode ?? ''}`;
    if (matchKeyRef.current !== key) {
      matchKeyRef.current = key;
      setMatchOpen(false);
      setMatch(null);
      setMatchLoading(false);
      setMatchError(false);
      setEditAddr(false);
    }
  }, [complaint.address, complaint.areaLkCode]);

  return (
    <article className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-sm font-bold tabular-nums">№{complaint.number}</span>
        <Badge
          variant="outline"
          className="h-5 px-1.5 text-[10px]"
          title="Тип обращения"
        >
          {COMPLAINT_TYPE_LABELS[complaint.type] ?? complaint.type}
        </Badge>
        <Badge
          variant="outline"
          className={cn('h-5 px-1.5 text-[10px]', COMPLAINT_STATUS_BADGES[complaint.status])}
        >
          {COMPLAINT_STATUS_LABELS[complaint.status] ?? complaint.status}
        </Badge>
        <span
          className={cn(
            'inline-flex h-5 items-center rounded-full px-1.5 text-[10px] font-medium',
            COMPLAINT_SOURCE_BADGES[complaint.source] ?? 'bg-muted text-muted-foreground'
          )}
          title={complaint.source === 'scenario' ? 'Собрано ботом в диалоге' : 'Добавлено оператором'}
        >
          {COMPLAINT_SOURCE_LABELS[complaint.source] ?? complaint.source}
        </span>
        <time
          dateTime={complaint.createdAt}
          title="Создано"
          className="ml-auto text-[11px] text-muted-foreground tabular-nums"
        >
          {fmtDateTime(complaint.createdAt)}
        </time>
      </div>

      {complaint.description && (
        <>
          <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-snug">
            {complaint.description}
          </p>
          {isLong(complaint.description) && (
            <button
              type="button"
              onClick={() => onShowFull(complaint)}
              className="mt-1 min-h-11 rounded-md text-xs font-medium text-primary underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
            >
              показать полностью
            </button>
          )}
        </>
      )}

      {/* IMP-24-FE2-01: мета-строка — контакт, когда произошло, адрес/координаты, КП */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {complaint.contact && (
          <span className="inline-flex items-center gap-1" title="Контакт клиента">
            <User className="h-3 w-3" aria-hidden="true" /> {complaint.contact}
          </span>
        )}
        {complaint.happenedAt && (
          <span className="tabular-nums" title="Когда произошло">
            <CalendarDays className="mr-1 inline h-3 w-3" aria-hidden="true" />
            {fmtDay(complaint.happenedAt)}
          </span>
        )}
        {complaint.address ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 line-clamp-1" title={complaint.address}>
              {complaint.address}
            </span>
            <button
              type="button"
              onClick={openAddressEditor}
              aria-label="Изменить адрес"
              title="Изменить адрес"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-6 sm:w-6"
            >
              <PencilLine className="h-3 w-3" aria-hidden="true" />
            </button>
            {/* IMP-25-25: перегеокодировать — бэк пересчитает точку по адресу (25-BE2) */}
            <button
              type="button"
              onClick={() => void regeocode()}
              aria-label="Перегеокодировать адрес"
              title="Перегеокодировать: пересчитать точку по адресу"
              disabled={saving}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:h-6 sm:w-6"
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
              )}
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={openAddressEditor}
            className="inline-flex min-h-11 items-center gap-1 rounded-md font-medium text-primary underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            <PencilLine className="h-3 w-3" aria-hidden="true" />
            Указать адрес
          </button>
        )}
        {complaint.lat != null && complaint.lng != null && (
          // IMP-25-25: координаты — кнопка с копированием (как в заявках), tabular-nums
          <button
            type="button"
            onClick={() => void copyCoords()}
            title="Скопировать координаты"
            aria-label="Скопировать координаты"
            className="inline-flex min-h-11 items-center gap-1 rounded-md tabular-nums transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            {fmtCoords(complaint.lat, complaint.lng)}
            <Copy className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
        {complaint.areaLkCode && (
          <Badge
            variant="outline"
            className="h-5 px-1.5 text-[10px] bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30"
            title={complaint.areaAddress ?? 'Контейнерная площадка'}
          >
            КП {complaint.areaLkCode}
          </Badge>
        )}
      </div>

      {/* IMP-25-25: одноразовый хинт — бэк пересчитал точку по новому адресу */}
      {geoHint && (
        <p
          role="status"
          className="mt-1 flex items-center gap-1 text-[11px] text-sky-700 dark:text-sky-300"
        >
          <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
          Точка пересчитана по новому адресу
        </p>
      )}

      {/* IMP-24-FE2-03: inline-редактор адреса (Enter — сохранить) */}
      {editAddr && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveAddress();
          }}
        >
          <Input
            value={addrDraft}
            onChange={(e) => setAddrDraft(e.target.value)}
            maxLength={300}
            placeholder="улица и дом, город"
            aria-label="Адрес инцидента"
            autoFocus
            className="h-11 min-w-0 flex-1 basis-56 sm:h-9"
          />
          <Button
            type="submit"
            size="sm"
            className="min-h-11 sm:min-h-0"
            disabled={saving || !addrDraft.trim() || addrDraft.trim() === complaint.address}
          >
            Сохранить
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 sm:min-h-0"
            onClick={() => setEditAddr(false)}
          >
            Отмена
          </Button>
        </form>
      )}

      <div className="mt-3 border-t pt-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 hidden text-[11px] text-muted-foreground sm:inline">Статус:</span>
          {STATUS_FILTERS.filter((s) => s !== 'all').map((s) => (
            <button
              key={s}
              type="button"
              disabled={saving || complaint.status === s}
              aria-pressed={complaint.status === s}
              onClick={() => onStatusChange(complaint, s)}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-medium transition-colors sm:min-h-0 sm:py-1',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:pointer-events-none',
                complaint.status === s
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {COMPLAINT_STATUS_LABELS[s]}
            </button>
          ))}
          {/* IMP-25-26: эскалация — «Создать заявку» из жалобы либо чип «Заявка №N» */}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {complaint.orderId ? (
              <button
                type="button"
                onClick={openOrders}
                title="Открыть раздел «Заявки»"
                aria-label="Открыть раздел «Заявки»"
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 text-xs font-medium text-sky-800 transition-colors hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300 dark:hover:bg-sky-500/25 sm:min-h-0 sm:py-1"
              >
                <Truck className="h-3.5 w-3.5" aria-hidden />
                {orderNumber ? `Заявка №${orderNumber}` : 'Заявка создана'}
              </button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-0"
                onClick={() => void onEscalate(complaint)}
                disabled={saving || escalating}
              >
                {escalating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Truck className="h-3.5 w-3.5" aria-hidden />
                )}
                Создать заявку
              </Button>
            )}
            {complaint.conversationId && (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-0"
                onClick={openConversation}
              >
                <MessagesSquare className="h-3.5 w-3.5" aria-hidden />
                Открыть диалог
              </Button>
            )}
          </div>
        </div>

        {/* IMP-24-FE2-02: совмещение с КП реестра */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {complaint.areaLkCode ? (
            <>
              <Badge
                variant="outline"
                className="h-5 px-1.5 text-[10px] bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30"
                title={complaint.areaAddress ?? 'Контейнерная площадка'}
              >
                КП {complaint.areaLkCode}
              </Badge>
              {complaint.areaAddress && (
                <span
                  className="min-w-0 flex-1 basis-32 line-clamp-1 text-[11px] text-muted-foreground"
                  title={complaint.areaAddress}
                >
                  {complaint.areaAddress}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto min-h-11 sm:min-h-0"
                onClick={() => void unlinkArea()}
                disabled={saving}
              >
                <Unlink className="h-3.5 w-3.5" aria-hidden />
                Отвязать
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-0"
                onClick={toggleMatch}
                aria-expanded={matchOpen}
                disabled={saving}
              >
                <MapPinned className="h-3.5 w-3.5" aria-hidden />
                КП рядом…
              </Button>
              {matchLoading && (
                <span
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                  role="status"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Ищу совпадения…
                </span>
              )}
            </>
          )}
        </div>

        {/* IMP-24-FE2-02: кандидаты area-match — до 3 строк */}
        {matchOpen && !complaint.areaLkCode && (
          <div
            className="mt-2 rounded-lg border bg-muted/30 p-2"
            aria-live="polite"
          >
            {matchError ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>Не удалось загрузить совпадения.</span>
                <button
                  type="button"
                  onClick={() => void loadMatch()}
                  className="min-h-11 rounded-md font-medium text-primary underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
                >
                  Ещё раз
                </button>
              </div>
            ) : match && match.length > 0 ? (
              <ul className="space-y-1">
                {match.slice(0, 3).map((cand) => {
                  const dist = cand.distanceM != null ? Math.round(cand.distanceM) : null;
                  const matchTitle =
                    cand.byCoord && dist != null
                      ? `совпадение по координатам (${dist} м)`
                      : cand.byAddress
                        ? 'совпадение по адресу'
                        : 'возможное совпадение';
                  return (
                    <li
                      key={cand.lkCode}
                      title={matchTitle}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1"
                    >
                      <span className="min-w-0 flex-1 basis-40 text-xs leading-snug">
                        <span className="font-medium tabular-nums text-foreground">
                          {cand.lkCode}
                        </span>
                        <span className="text-muted-foreground">
                          {' '}— {cand.address ?? 'без адреса'}
                          {dist != null ? ` · ${dist} м` : ''}
                        </span>
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 sm:min-h-0"
                        disabled={saving}
                        onClick={() => void linkArea(cand.lkCode)}
                      >
                        Совместить
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : match ? (
              <div className="text-xs text-muted-foreground">
                <p>Совпадений с реестром КП не найдено.</p>
                <button
                  type="button"
                  onClick={openAddressEditor}
                  className="mt-0.5 min-h-11 rounded-md text-primary underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
                >
                  {complaint.address
                    ? 'Уточните адрес, чтобы найти площадку'
                    : 'Укажите адрес, чтобы найти площадку'}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
});

export default function ComplaintsView({
  botId,
  onBack,
}: {
  botId: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<ComplaintDto[]>([]);
  const [counts, setCounts] = useState<ComplaintCounts>({ total: 0, new: 0, inReview: 0, resolved: 0 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  // IMP-25-26: идёт эскалация (POST заявки + PATCH orderId) — для спиннера кнопки
  const [escalatingId, setEscalatingId] = useState<string | null>(null);
  // IMP-25-26: номера заявок, созданных из жалоб в этой сессии (ComplaintDto несёт только orderId)
  const [orderNumbers, setOrderNumbers] = useState<Record<string, number>>({});

  // Диалог «Добавить вручную» (чистая форма при переоткрытии)
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    type: 'no_pickup',
    description: '',
    address: '',
    contact: '',
    happenedAt: '',
  });
  const [addBusy, setAddBusy] = useState(false);
  // Диалог полного описания
  const [fullItem, setFullItem] = useState<ComplaintDto | null>(null);

  // Курсор — в ref: колбэк поллинга не должен пересоздаваться на каждый ответ
  const nextCursorRef = useRef<string | null>(null);
  useEffect(() => {
    nextCursorRef.current = nextCursor;
  }, [nextCursor]);

  // IMP-25-23: жива ли хотя бы одна догруженная «Показать ещё» страница.
  // Пока живы — поллинг не откатывает курсор на конец первой страницы,
  // иначе «Показать ещё» начинало бы перекрывать уже загруженное.
  const extraPagesRef = useRef(false);

  // IMP-25-23: load умеет три режима.
  //  — load(cursor) — «Показать ещё»: аппенд с дедупом (как раньше);
  //  — load(null, true) — ПОЛЛИНГ: merge первой страницы — новые (по id) сверху,
  //    существующие обновляются по id (статусы/патчи), догруженные старые НЕ удаляются;
  //  — load() — жёсткая перезагрузка (первый вход / смена фильтров / retry).
  const load = useCallback(
    async (cursor?: string | null, merge = false) => {
      const append = !!cursor;
      if (!append && !merge) {
        setError(false);
        extraPagesRef.current = false;
      }
      try {
        const params = new URLSearchParams();
        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (typeFilter !== 'all') params.set('type', typeFilter);
        params.set('take', String(TAKE));
        if (cursor) params.set('cursor', cursor);
        const d = await api<{ items: ComplaintDto[]; nextCursor: string | null; counts: ComplaintCounts }>(
          `/api/bots/${botId}/complaints?${params.toString()}`
        );
        setCounts(d.counts);
        if (append) {
          extraPagesRef.current = true;
          setNextCursor(d.nextCursor);
          // Дедуп: между страницами список мог обновиться (поллинг)
          setItems((prev) => {
            const seen = new Set(prev.map((c) => c.id));
            return [...prev, ...d.items.filter((c) => !seen.has(c.id))];
          });
        } else if (merge) {
          setNextCursor((cur) => (extraPagesRef.current ? cur : d.nextCursor));
          setItems((prev) => {
            const incomingIds = new Set(d.items.map((c) => c.id));
            const merged = [...d.items, ...prev.filter((c) => !incomingIds.has(c.id))];
            // Сортировка как на бэке (createdAt desc, id desc) — merges не ломают порядок
            return merged.sort(cmpServerOrder);
          });
        } else {
          setNextCursor(d.nextCursor);
          setItems(d.items);
        }
      } catch {
        if (!append && !merge) setError(true);
        /* ошибки поллинга молча — как в inbox-view */
      } finally {
        if (!append) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [botId, statusFilter, typeFilter]
  );

  // Первая загрузка + перезагрузка при смене фильтров (loadList-паттерн inbox-view)
  useEffect(() => {
    void load();
  }, [load]);

  // Поллинг: 8 с, пауза при document.hidden; IMP-25-23 — merge-режим (не схлопывает список);
  // IMP-25-REV-2: каждый 10-й тик — жёсткая перезагрузка, чтобы записи, выпавшие из фильтра
  // (например, статус сменил коллега), не висели в отфильтрованном списке вечно.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let tickCount = 0;
    const tick = () => {
      tickCount += 1;
      if (tickCount % 10 === 0) void load();
      else void load(null, true);
    };
    const start = () => {
      if (timer === null) timer = setInterval(tick, 8000);
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
  }, [load]);

  const loadMore = () => {
    if (loadingMore || !nextCursorRef.current) return;
    setLoadingMore(true);
    void load(nextCursorRef.current);
  };

  /** Оптимистичная смена статуса с откатом при ошибке (паттерн togglePin из inbox-view) */
  const changeStatus = async (complaint: ComplaintDto, status: string) => {
    if (savingId || status === complaint.status) return;
    const prevStatus = complaint.status;
    setItems((list) => list.map((c) => (c.id === complaint.id ? { ...c, status } : c)));
    setCounts((cnt) => {
      const from = complaintCountKey(prevStatus);
      const to = complaintCountKey(status);
      if (from === to) return cnt;
      return { ...cnt, [from]: Math.max(0, cnt[from] - 1), [to]: cnt[to] + 1 };
    });
    setSavingId(complaint.id);
    try {
      const d = await api<{ item: ComplaintDto }>(`/api/bots/${botId}/complaints/${complaint.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setItems((list) => list.map((c) => (c.id === complaint.id ? d.item : c)));
    } catch (e) {
      // Откат: статус и счётчики
      setItems((list) => list.map((c) => (c.id === complaint.id ? { ...c, status: prevStatus } : c)));
      setCounts((cnt) => {
        const from = complaintCountKey(status);
        const to = complaintCountKey(prevStatus);
        if (from === to) return cnt;
        return { ...cnt, [from]: Math.max(0, cnt[from] - 1), [to]: cnt[to] + 1 };
      });
      toast({
        title: 'Не удалось изменить статус',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSavingId(null);
    }
  };

  // IMP-24-FE2-04: общий оптимистичный PATCH адреса/КП с откатом (паттерн changeStatus).
  // Статус намеренно идёт через changeStatus — там дополнительно корректируются счётчики фильтров.
  const patchComplaint = useCallback(
    async (
      complaint: ComplaintDto,
      patch: ComplaintPatch,
      successTitle: string
    ): Promise<boolean> => {
      // IMP-25-24: «занято» — тоже фейл, показываем тостом (тихих фейлов больше нет)
      if (savingId) {
        toast({
          title: 'Не удалось сохранить изменения',
          description: 'Другое изменение ещё сохраняется — повторите через мгновение.',
          variant: 'destructive',
        });
        return false;
      }
      const prev = complaint;
      setItems((list) =>
        list.map((c) => (c.id === complaint.id ? { ...c, ...patch } : c))
      );
      setSavingId(complaint.id);
      try {
        const d = await api<{ item: ComplaintDto }>(
          `/api/bots/${botId}/complaints/${complaint.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify(patch),
          }
        );
        setItems((list) => list.map((c) => (c.id === complaint.id ? d.item : c)));
        toast({ title: successTitle });
        return true;
      } catch (e) {
        // Откат к прежнему объекту жалобы
        setItems((list) =>
          list.map((c) => (c.id === complaint.id ? prev : c))
        );
        toast({
          title: 'Не удалось сохранить изменения',
          description: e instanceof Error ? e.message : '',
          variant: 'destructive',
        });
        return false;
      } finally {
        setSavingId(null);
      }
    },
    [botId, savingId, toast]
  );

  // IMP-25-25: перегеокодировать точку жалобы — PATCH {geocode:true} (контракт 25-BE2).
  // Не оптимистично: координаты считает бэк, ответ — полный DTO.
  const geocodeComplaint = useCallback(
    async (complaint: ComplaintDto): Promise<boolean> => {
      if (savingId) {
        toast({
          title: 'Не удалось перегеокодировать',
          description: 'Другое изменение ещё сохраняется — повторите через мгновение.',
          variant: 'destructive',
        });
        return false;
      }
      setSavingId(complaint.id);
      try {
        const d = await api<{ item: ComplaintDto }>(
          `/api/bots/${botId}/complaints/${complaint.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ geocode: true }),
          }
        );
        setItems((list) => list.map((c) => (c.id === complaint.id ? d.item : c)));
        toast({
          title:
            d.item.lat != null && d.item.lng != null
              ? `Точка обновлена: ${fmtCoords(d.item.lat, d.item.lng)}`
              : 'Точку не удалось определить — адрес не найден на карте',
        });
        return true;
      } catch (e) {
        toast({
          title: 'Не удалось перегеокодировать',
          description: e instanceof Error ? e.message : '',
          variant: 'destructive',
        });
        return false;
      } finally {
        setSavingId(null);
      }
    },
    [botId, savingId, toast]
  );

  // IMP-25-26: эскалация — заявка из жалобы. POST /orders принимает адрес/точку/
  // клиента/телефон/комментарий (проверено по роуту), затем жалоба линкуется PATCH {orderId}.
  const escalateToOrder = useCallback(
    async (complaint: ComplaintDto): Promise<boolean> => {
      if (savingId) {
        toast({
          title: 'Не удалось создать заявку',
          description: 'Другое изменение ещё сохраняется — повторите через мгновение.',
          variant: 'destructive',
        });
        return false;
      }
      setSavingId(complaint.id);
      setEscalatingId(complaint.id);
      try {
        const created = await api<{ order: { id: string; number: number } }>(
          `/api/bots/${botId}/orders`,
          {
            method: 'POST',
            body: JSON.stringify({
              address: complaint.address,
              lat: complaint.lat,
              lng: complaint.lng,
              phone: complaint.contact,
              clientName: complaint.contact || null,
              comment: `По жалобе №${complaint.number}: ${complaint.description}`.slice(0, 500),
              city: null,
            }),
          }
        );
        const linked = await api<{ item: ComplaintDto }>(
          `/api/bots/${botId}/complaints/${complaint.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ orderId: created.order.id }),
          }
        );
        setItems((list) => list.map((c) => (c.id === complaint.id ? linked.item : c)));
        setOrderNumbers((p) => ({ ...p, [complaint.id]: created.order.number }));
        toast({ title: `Заявка №${created.order.number} создана из жалобы` });
        return true;
      } catch (e) {
        toast({
          title: 'Не удалось создать заявку из жалобы',
          description: e instanceof Error ? e.message : '',
          variant: 'destructive',
        });
        return false;
      } finally {
        setSavingId(null);
        setEscalatingId(null);
      }
    },
    [botId, savingId, toast]
  );

  const submitAdd = async () => {
    if (addBusy) return;
    const description = form.description.trim();
    if (!description) return;
    setAddBusy(true);
    try {
      const body: Record<string, unknown> = { type: form.type, description };
      // IMP-24-FE2-05: адрес опционален — бэкенд сам геокодирует, если нет координат
      if (form.address.trim()) body.address = form.address.trim();
      if (form.contact.trim()) body.contact = form.contact.trim();
      if (form.happenedAt) body.happenedAt = form.happenedAt;
      const d = await api<{ item: ComplaintDto }>(`/api/bots/${botId}/complaints`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setAddOpen(false);
      setForm({
        type: 'no_pickup',
        description: '',
        address: '',
        contact: '',
        happenedAt: '',
      });
      toast({ title: 'Обращение добавлено', description: `№${d.item.number}` });
      // Новое обращение имеет статус new — если фильтр его прячет, показываем «Все»
      if (statusFilter !== 'all' && statusFilter !== 'new') setStatusFilter('all');
      // IMP-25-23: merge, чтобы не схлопнуть догруженные «Показать ещё» страницы
      else void load(null, true);
    } catch (e) {
      toast({
        title: 'Не удалось добавить обращение',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    } finally {
      setAddBusy(false);
    }
  };

  const chips: { key: StatusFilter; label: string; count: number; accent?: boolean }[] = [
    { key: 'all', label: 'Все', count: counts.total },
    { key: 'new', label: 'Новые', count: counts.new, accent: true },
    { key: 'in_review', label: 'В работе', count: counts.inReview },
    { key: 'resolved', label: 'Решены', count: counts.resolved },
  ];

  const isFiltered = statusFilter !== 'all' || typeFilter !== 'all';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Шапка */}
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
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
            <MessageCircleWarning className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" aria-hidden />
            Обращения
          </h1>
          <p className="truncate text-xs text-muted-foreground sm:text-sm">
            Жалобы клиентов из бота и ручные
          </p>
        </div>
        <Button className="min-h-11 shrink-0 sm:min-h-9" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Добавить вручную</span>
          <span className="sm:hidden">Добавить</span>
        </Button>
      </div>

      {/* Фильтры: чипы статусов (со счётчиками) + тип обращения */}
      <div className="flex flex-wrap items-center gap-1.5 border-b bg-background px-2.5 py-2 sm:px-4">
        {chips.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatusFilter(f.key)}
            aria-pressed={statusFilter === f.key}
            className={cn(
              'inline-flex min-h-11 items-center rounded-full px-3 text-xs font-medium transition-colors sm:min-h-0 sm:py-1.5',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              statusFilter === f.key
                ? 'border border-transparent bg-primary text-primary-foreground'
                : 'border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {f.label}
            {f.count > 0 && (
              <span
                className={cn(
                  'ml-1.5 inline-flex items-center rounded-full px-1.5 text-[10px] tabular-nums',
                  f.accent && statusFilter !== f.key
                    ? 'bg-amber-100 font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
                    : cn('opacity-80', statusFilter === f.key && 'bg-white/20')
                )}
              >
                {f.count}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger
              className="h-11 w-[160px] text-xs sm:h-8 sm:w-[190px]"
              aria-label="Тип обращения"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                Все типы
              </SelectItem>
              {Object.entries(COMPLAINT_TYPE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k} className="text-xs">
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Список */}
      {loading ? (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 sm:p-4" role="status" aria-label="Загрузка обращений">
          {Array.from({ length: 5 }).map((_, i) => (
            <ComplaintCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={WifiOff}
          title="Не удалось загрузить обращения"
          hint="Проверьте связь и попробуйте ещё раз."
        />
      ) : items.length === 0 ? (
        isFiltered ? (
          <EmptyState
            icon={CircleAlert}
            title="Ничего не найдено"
            hint="Попробуйте другой статус или тип обращения."
          />
        ) : (
          <EmptyState
            icon={MessageCircleWarning}
            title="Обращений пока нет"
            hint="Жалобы из сценария бота появляются здесь автоматически. Также их можно добавить вручную."
          />
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          <div className="mx-auto max-w-3xl space-y-2">
            {items.map((c) => (
              <ComplaintCard
                key={c.id}
                complaint={c}
                botId={botId}
                saving={savingId === c.id}
                escalating={escalatingId === c.id}
                orderNumber={orderNumbers[c.id]}
                onStatusChange={(complaint, status) => void changeStatus(complaint, status)}
                onShowFull={setFullItem}
                onPatch={patchComplaint}
                onGeocode={geocodeComplaint}
                onEscalate={escalateToOrder}
              />
            ))}
            {nextCursor && (
              <div className="flex justify-center pt-1">
                <Button
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Показать ещё
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Повтор при ошибке первой загрузки */}
      {error && (
        <div className="flex justify-center pb-4">
          <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => void load()}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            Повторить
          </Button>
        </div>
      )}

      {/* Полное описание */}
      <Dialog open={!!fullItem} onOpenChange={(o) => !o && setFullItem(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Обращение №{fullItem?.number ?? ''}</DialogTitle>
            <DialogDescription>
              {fullItem ? COMPLAINT_TYPE_LABELS[fullItem.type] ?? fullItem.type : ''}
              {fullItem?.happenedAt ? ` · ${fmtDay(fullItem.happenedAt)}` : ''}
            </DialogDescription>
          </DialogHeader>
          <p className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
            {fullItem?.description}
          </p>
          {fullItem?.contact && (
            <p className="text-xs text-muted-foreground">Контакт: {fullItem.contact}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFullItem(null)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Добавить вручную */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить обращение</DialogTitle>
            <DialogDescription>
              Жалоба, принятая по телефону или лично, появится в общем списке
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitAdd();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="cmp-type" className="text-xs font-medium">
                Тип обращения
              </Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}
              >
                <SelectTrigger id="cmp-type" className="min-h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(COMPLAINT_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cmp-desc" className="text-xs font-medium">
                Описание
              </Label>
              <Textarea
                id="cmp-desc"
                autoFocus
                required
                rows={4}
                maxLength={2000}
                placeholder="Что произошло, где, с каким контейнером…"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            {/* IMP-24-FE2-05: адрес инцидента — для геокодинга и поиска КП */}
            <div className="space-y-2">
              <Label htmlFor="cmp-address" className="text-xs font-medium">
                Адрес{' '}
                <span className="font-normal text-muted-foreground">(необязательно)</span>
              </Label>
              <Input
                id="cmp-address"
                placeholder="улица и дом, город"
                maxLength={300}
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cmp-contact" className="text-xs font-medium">
                Контакт клиента{' '}
                <span className="font-normal text-muted-foreground">(необязательно)</span>
              </Label>
              <Input
                id="cmp-contact"
                placeholder="телефон или имя"
                value={form.contact}
                onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cmp-when" className="text-xs font-medium">
                Когда произошло{' '}
                <span className="font-normal text-muted-foreground">(необязательно)</span>
              </Label>
              <Input
                id="cmp-when"
                type="date"
                value={form.happenedAt}
                onChange={(e) => setForm((f) => ({ ...f, happenedAt: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={addBusy}>
                Отмена
              </Button>
              <Button type="submit" disabled={addBusy || !form.description.trim()}>
                {addBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {addBusy ? 'Добавляю…' : 'Добавить'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

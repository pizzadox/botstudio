'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl';
import {
  Archive,
  ChevronLeft,
  Crosshair,
  Globe,
  Headset,
  Loader2,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  User,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import type { OrderDto, OrderMessageDto } from '@/lib/studio-types';
import {
  ORDER_STATUS_BADGES,
  ORDER_STATUS_LABELS,
  ORDER_TYPE_ICONS,
  ORDER_TYPE_LABELS,
  SOURCE_COLORS,
  SOURCE_LABELS,
} from '@/lib/studio-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type Tab = 'map' | 'active' | 'archive';

const ACTIVE_STATUSES = ['new', 'assigned', 'in_progress'];
const ARCHIVE_STATUSES = ['completed', 'cancelled'];

/** Цвет маркера на карте */
function markerColor(order: OrderDto): string {
  if (ARCHIVE_STATUSES.includes(order.status)) return 'bg-slate-400';
  switch (order.type) {
    case 'waste':
      return 'bg-emerald-500';
    case 'kgm':
      return 'bg-amber-500';
    default:
      return 'bg-violet-500';
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Карта OpenFreeMap (MapLibre GL, бесплатные векторные тайлы без ключа) ───

function OrdersMap({
  orders,
  showCompleted,
  placementOrderId,
  onSelect,
  onPlace,
}: {
  orders: OrderDto[];
  showCompleted: boolean;
  placementOrderId: string | null;
  onSelect: (id: string) => void;
  onPlace: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const mlRef = useRef<typeof import('maplibre-gl') | null>(null);
  const markersRef = useRef<MlMarker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoomKey, setZoomKey] = useState(0);

  // Инициализация карты (динамический импорт — компонент клиентский)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ml = await import('maplibre-gl');
        if (cancelled || !containerRef.current) return;
        // Воркер MapLibre не собирается Turbopack'ом — берём локальную копию из public/
        ml.setWorkerUrl('/maplibre-gl-worker.mjs');
        mlRef.current = ml;
        const map = new ml.Map({
          container: containerRef.current,
          style: 'https://tiles.openfreemap.org/styles/liberty',
          center: [37.6176, 55.7558], // Москва — стартовый вид
          zoom: 8.5,
        });
        map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        map.on('load', () => {
          if (!cancelled) setReady(true);
        });
        map.on('error', (e) => {
          // Тайловая сеть недоступна — сообщаем, но карту не убиваем
          console.warn('[orders map]', e?.error?.message ?? e);
        });
        mapRef.current = map;
      } catch (err) {
        console.error('[orders map] init failed', err);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Маркеры заявок
  const visible = orders.filter(
    (o) => o.lat != null && o.lng != null && (showCompleted || ACTIVE_STATUSES.includes(o.status))
  );

  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml || !ready) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    for (const o of visible) {
      const el = document.createElement('button');
      el.type = 'button';
      el.title = `Заявка №${o.number} — ${ORDER_TYPE_LABELS[o.type] ?? ''}`;
      el.className = cn(
        'flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow-lg transition-transform hover:scale-110',
        markerColor(o)
      );
      el.textContent = String(o.number);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelect(o.id);
      });
      const marker = new ml.Marker({ element: el })
        .setLngLat([o.lng as number, o.lat as number])
        .addTo(map);
      markersRef.current.push(marker);
    }
    // зависимость — сериализованный список видимых маркеров
  }, [ready, zoomKey, visible.map((o) => `${o.id}:${o.lat}:${o.lng}:${o.status}`).join('|')]);

  // Режим указания точки: клик по карте → координаты заявки
  const handleMapClick = useCallback(
    (lat: number, lng: number) => onPlace(lat, lng),
    [onPlace]
  );
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !placementOrderId) return;
    const onClick = (e: { lngLat: { lat: number; lng: number } }) =>
      handleMapClick(e.lngLat.lat, e.lngLat.lng);
    map.on('click', onClick);
    map.getCanvas().style.cursor = 'crosshair';
    return () => {
      map.off('click', onClick);
      map.getCanvas().style.cursor = '';
    };
  }, [ready, placementOrderId, handleMapClick]);

  if (failed) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 rounded-xl border bg-muted/30 text-center text-muted-foreground">
        <MapPin className="h-10 w-10 opacity-30" />
        <p className="max-w-xs text-sm">
          Не удалось загрузить карту OpenFreeMap. Проверьте доступ к tiles.openfreemap.org и
          обновите страницу.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden rounded-xl border bg-muted/30">
      <div ref={containerRef} className="h-full w-full" aria-label="Карта заявок" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаю карту OpenFreeMap…
        </div>
      )}
      {/* Легенда */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border bg-background/95 px-3 py-2 text-[11px] shadow-sm backdrop-blur">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> вывоз отходов
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> КГМ
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400" /> выполненные
        </span>
      </div>
      {/* Счётчик маркеров */}
      <div className="absolute left-3 top-3 rounded-lg border bg-background/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur">
        <MapPin className="mr-1 inline h-3 w-3 text-primary" />
        На карте: <b>{visible.length}</b>
      </div>
      {placementOrderId && (
        <div className="absolute inset-x-3 top-3 z-10 flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/95 px-3 py-2 text-xs text-primary-foreground shadow-md md:right-auto">
          <span className="flex items-center gap-1.5">
            <Crosshair className="h-3.5 w-3.5" /> Кликните по карте — точка заявки №
            {placementOrderId}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Чат по заявке ───────────────────────────────────────────────────────────

function OrderChat({
  botId,
  orderId,
  hasConversation,
}: {
  botId: string;
  orderId: string;
  hasConversation: boolean;
}) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<OrderMessageDto[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ messages: OrderMessageDto[] }>(
        `/api/bots/${botId}/orders/${orderId}/messages`
      );
      setMessages(d.messages);
    } catch {
      /* polling errors ignored */
    }
  }, [botId, orderId]);

  useEffect(() => {
    setMessages([]);
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, [messages.length]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setSending(true);
    setText('');
    try {
      const d = await api<{ message: OrderMessageDto; delivered: boolean; deliveryError?: string }>(
        `/api/bots/${botId}/orders/${orderId}/messages`,
        { method: 'POST', body: JSON.stringify({ text: t }) }
      );
      setMessages((prev) => [...prev, d.message]);
      if (!d.delivered && d.deliveryError) {
        toast({ title: 'Не доставлено в мессенджер', description: d.deliveryError, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Не удалось отправить', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" />
        Чат с клиентом по заявке — сообщения доставляются в его мессенджер
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 p-3">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
            Сообщений по заявке пока нет.
            <br />
            Клиент может написать в боте, открыв карточку своей заявки.
          </div>
        )}
        {messages.map((m) => {
          const fromClient = m.role === 'user';
          return (
            <div key={m.id} className={cn('flex', fromClient ? 'justify-start' : 'justify-end')}>
              <div
                className={cn(
                  'max-w-[85%] space-y-0.5 rounded-2xl px-3 py-1.5 text-sm leading-snug',
                  fromClient
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
          );
        })}
      </div>
      <form
        className="flex items-center gap-2 border-t p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Input
          placeholder={
            hasConversation
              ? 'Ответить клиенту…'
              : 'Диалог с клиентом не привязан — чат только для чтения'
          }
          value={text}
          disabled={!hasConversation}
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          type="submit"
          size="icon"
          className="h-10 w-10 shrink-0"
          disabled={sending || !hasConversation || !text.trim()}
          aria-label="Отправить"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}

// ─── Карточка заявки + карточка клиента ──────────────────────────────────────

function OrderDetailDialog({
  botId,
  orderId,
  open,
  onClose,
  onSwitchOrder,
  onPlaceRequest,
  onDataChanged,
}: {
  botId: string;
  orderId: string | null;
  open: boolean;
  onClose: () => void;
  onSwitchOrder: (id: string) => void;
  onPlaceRequest: (orderId: string) => void;
  onDataChanged: () => void;
}) {
  const { toast } = useToast();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [clientOrders, setClientOrders] = useState<OrderDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [wishDate, setWishDate] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const d = await api<{ order: OrderDto; clientOrders: OrderDto[] }>(
        `/api/bots/${botId}/orders/${orderId}`
      );
      setOrder(d.order);
      setClientOrders(d.clientOrders);
      setAssignee(d.order.assignee ?? '');
      setWishDate(d.order.wishDate ?? '');
      setComment(d.order.comment ?? '');
    } catch {
      toast({ title: 'Не удалось загрузить заявку', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [botId, orderId, toast]);

  useEffect(() => {
    if (open && orderId) load();
    if (!open) {
      setOrder(null);
      setClientOrders([]);
      setConfirmDelete(false);
    }
  }, [open, orderId, load]);

  const patch = async (data: Record<string, unknown>, successMsg?: string) => {
    if (!orderId) return;
    setSaving(true);
    try {
      const d = await api<{ order: OrderDto }>(`/api/bots/${botId}/orders/${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      setOrder(d.order);
      onDataChanged();
      if (successMsg) toast({ title: successMsg });
    } catch {
      toast({ title: 'Ошибка сохранения', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!orderId) return;
    try {
      await api(`/api/bots/${botId}/orders/${orderId}`, { method: 'DELETE' });
      toast({ title: `Заявка удалена` });
      onDataChanged();
      onClose();
    } catch {
      toast({ title: 'Не удалось удалить', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="grid h-[90dvh] max-w-4xl grid-rows-[auto_1fr] gap-0 overflow-hidden p-0 md:h-[85vh]">
        <DialogHeader className="border-b px-4 py-3 md:px-5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="text-lg">{order ? ORDER_TYPE_ICONS[order.type] : '📋'}</span>
            {order ? `Заявка №${order.number} — ${ORDER_TYPE_LABELS[order.type] ?? ''}` : 'Заявка'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Карточка заявки: данные клиента, статус и встроенный чат
          </DialogDescription>
        </DialogHeader>

        {!order && loading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Загрузка…
          </div>
        ) : !order ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground">
            Заявка не найдена
          </div>
        ) : (
          <div className="grid min-h-0 overflow-y-auto md:grid-cols-2 md:overflow-hidden">
            {/* Левая колонка: клиент + данные заявки */}
            <div className="min-h-0 space-y-4 border-b p-4 md:border-b-0 md:border-r md:overflow-y-auto">
              {/* Клиент */}
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <User className="h-3.5 w-3.5" /> Карточка клиента
                  </h3>
                  {order.conversation && (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-medium',
                        SOURCE_COLORS[order.conversation.source] ?? 'bg-muted text-muted-foreground'
                      )}
                    >
                      {SOURCE_LABELS[order.conversation.source] ?? order.conversation.source}
                    </span>
                  )}
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  <div className="font-medium">
                    {order.clientName || order.conversation?.contact || 'Клиент без имени'}
                  </div>
                  {order.phone && (
                    <a
                      href={`tel:${order.phone.replace(/[^\d+]/g, '')}`}
                      className="flex w-fit items-center gap-1.5 text-primary hover:underline"
                    >
                      <Phone className="h-3.5 w-3.5" /> {order.phone}
                    </a>
                  )}
                  {order.conversation?.externalUserId && (
                    <div className="text-xs text-muted-foreground">
                      ID клиента: {order.conversation.externalUserId}
                    </div>
                  )}
                </div>
                {/* История заказов клиента */}
                {clientOrders.length > 1 && (
                  <div className="mt-3 border-t pt-2">
                    <div className="text-[11px] font-medium text-muted-foreground">
                      Заказы клиента ({clientOrders.length}):
                    </div>
                    <div className="mt-1.5 flex max-h-36 flex-col gap-1 overflow-y-auto pr-1">
                      {clientOrders.map((o) => (
                        <button
                          key={o.id}
                          onClick={() => onSwitchOrder(o.id)}
                          className={cn(
                            'flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted',
                            o.id === order.id && 'border-primary/50 bg-primary/5'
                          )}
                        >
                          <span>№{o.number}</span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {ORDER_TYPE_LABELS[o.type] ?? o.type}
                            {o.address ? ` · ${o.address}` : ''}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn('h-4 shrink-0 px-1 text-[9px]', ORDER_STATUS_BADGES[o.status])}
                          >
                            {ORDER_STATUS_LABELS[o.status] ?? o.status}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Данные заявки */}
              <div className="space-y-3 rounded-xl border p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Статус</Label>
                    <Select
                      value={order.status}
                      onValueChange={(v) => patch({ status: v }, 'Статус обновлён')}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Желаемая дата</Label>
                    <Input
                      className="h-9"
                      value={wishDate}
                      placeholder="напр. завтра до 12:00"
                      onChange={(e) => setWishDate(e.target.value)}
                      onBlur={() => {
                        if (wishDate !== (order.wishDate ?? '')) {
                          patch({ wishDate }, 'Дата обновлена');
                        }
                      }}
                      disabled={saving}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Исполнитель</Label>
                  <div className="flex gap-2">
                    <Input
                      className="h-9"
                      value={assignee}
                      placeholder="Бригада / водитель"
                      onChange={(e) => setAssignee(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0"
                      disabled={saving}
                      onClick={() => patch({ assignee }, 'Исполнитель назначен')}
                    >
                      Назначить
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Адрес вывоза</Label>
                  <div className="text-sm">{order.address || '— не указан —'}</div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => onPlaceRequest(order.id)}
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                      {order.lat != null ? 'Перенести точку' : 'Указать на карте'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={saving}
                      onClick={() => patch({ geocode: true }, order.lat != null ? 'Координаты обновлены' : 'Адрес не найден на карте')}
                    >
                      <Globe className="h-3.5 w-3.5" /> Геокодировать
                    </Button>
                  </div>
                  {order.lat != null && (
                    <div className="pt-1 text-[11px] text-muted-foreground">
                      Координаты: {order.lat.toFixed(5)}, {order.lng?.toFixed(5)}
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Состав / объём</Label>
                  <div className="text-sm">{order.size || '—'}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Комментарий оператора</Label>
                  <Textarea
                    rows={2}
                    value={comment}
                    placeholder="Заметки по заявке…"
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={saving}
                    onClick={() => patch({ comment }, 'Комментарий сохранён')}
                  >
                    Сохранить комментарий
                  </Button>
                </div>
                <div className="flex items-center justify-between border-t pt-2 text-[11px] text-muted-foreground">
                  <span>Создана: {fmtDate(order.createdAt)}</span>
                  {confirmDelete ? (
                    <span className="flex items-center gap-1.5">
                      Удалить заявку?
                      <Button size="sm" variant="destructive" className="h-7" onClick={remove}>
                        Да
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={() => setConfirmDelete(false)}
                      >
                        Нет
                      </Button>
                    </span>
                  ) : (
                    <button
                      className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-destructive"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 className="h-3 w-3" /> удалить
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Правая колонка: встроенный чат с пользователем */}
            <div className="flex min-h-0 flex-col md:overflow-hidden">
              <OrderChat
                botId={botId}
                orderId={order.id}
                hasConversation={!!order.conversationId}
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Диалог создания заявки оператором ───────────────────────────────────────

function NewOrderDialog({
  botId,
  open,
  onClose,
  onCreated,
}: {
  botId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    type: 'waste',
    clientName: '',
    phone: '',
    address: '',
    size: '',
    wishDate: '',
    comment: '',
  });

  const submit = async () => {
    if (!form.address.trim() && !form.clientName.trim()) {
      toast({ title: 'Укажите хотя бы адрес или имя клиента', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await api(`/api/bots/${botId}/orders`, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      toast({ title: 'Заявка создана — координаты подбираются автоматически' });
      setForm({ type: 'waste', clientName: '', phone: '', address: '', size: '', wishDate: '', comment: '' });
      onCreated();
      onClose();
    } catch {
      toast({ title: 'Не удалось создать заявку', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая заявка</DialogTitle>
          <DialogDescription>
            Заявку можно создать вручную — она появится на карте и в списке
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Тип</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="waste">🚛 Вывоз отходов</SelectItem>
                  <SelectItem value="kgm">📦 Вывоз КГМ</SelectItem>
                  <SelectItem value="other">📋 Другое</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Телефон</Label>
              <Input
                value={form.phone}
                placeholder="+7 900 …"
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Клиент</Label>
            <Input
              value={form.clientName}
              placeholder="Имя клиента"
              onChange={(e) => setForm({ ...form, clientName: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Адрес</Label>
            <Input
              value={form.address}
              placeholder="Город, улица, дом"
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Объём / состав</Label>
              <Input
                value={form.size}
                placeholder="8 м³, диван…"
                onChange={(e) => setForm({ ...form, size: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Дата подачи</Label>
              <Input
                value={form.wishDate}
                placeholder="завтра до 12:00"
                onChange={(e) => setForm({ ...form, wishDate: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Комментарий</Label>
            <Textarea
              rows={2}
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Создать
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Строка списка заявок ────────────────────────────────────────────────────

function OrderRow({
  order,
  onOpen,
}: {
  order: OrderDto;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onOpen(order.id)}
      className={cn(
        'flex w-full flex-col gap-1.5 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/60',
        order.status === 'new' && 'border-amber-300/70'
      )}
    >
      <div className="flex w-full items-center gap-2">
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white',
            markerColor(order)
          )}
        >
          {order.number}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {ORDER_TYPE_ICONS[order.type]} {order.address || order.clientName || 'Без адреса'}
        </span>
        <Badge
          variant="outline"
          className={cn('shrink-0 px-1.5 text-[10px]', ORDER_STATUS_BADGES[order.status])}
        >
          {ORDER_STATUS_LABELS[order.status] ?? order.status}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-10 text-[11px] text-muted-foreground">
        {order.clientName && <span className="font-medium">{order.clientName}</span>}
        {order.phone && <span>{order.phone}</span>}
        {order.size && <span>{order.size}</span>}
        {order.wishDate && <span>🗓 {order.wishDate}</span>}
        {order.lat == null && (
          <span className="text-amber-600">📍 точка не указана</span>
        )}
        {typeof order.messagesCount === 'number' && order.messagesCount > 0 && (
          <span className="flex items-center gap-0.5">
            <MessageSquare className="h-3 w-3" /> {order.messagesCount}
          </span>
        )}
        <span className="ml-auto">{fmtDate(order.createdAt)}</span>
      </div>
    </button>
  );
}

// ─── Главный вид раздела «Заявки» ────────────────────────────────────────────

export default function OrdersView({
  bot,
  onBack,
}: {
  bot: { id: string; name: string };
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [placementId, setPlacementId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);
  const [typeFilter, setTypeFilter] = useState<'all' | 'waste' | 'kgm'>('all');
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ orders: OrderDto[] }>(`/api/bots/${bot.id}/orders`);
      setOrders(d.orders);
    } catch {
      /* ignore polling errors */
    } finally {
      setLoading(false);
    }
  }, [bot.id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  const openOrder = useCallback((id: string) => {
    setSelectedId(id);
    setDialogOpen(true);
  }, []);

  const placeRequest = useCallback(
    (orderId: string) => {
      const order = orders.find((o) => o.id === orderId);
      setDialogOpen(false);
      setPlacementId(orderId);
      setTab('map');
      toast({
        title: `Кликните по карте — укажу точку заявки №${order?.number ?? ''}`,
      });
    },
    [orders, toast]
  );

  const placeOnMap = useCallback(
    async (lat: number, lng: number) => {
      if (!placementId) return;
      const id = placementId;
      setPlacementId(null);
      try {
        await api(`/api/bots/${bot.id}/orders/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ lat, lng }),
        });
        toast({ title: 'Точка заявки сохранена на карте' });
        load();
      } catch {
        toast({ title: 'Не удалось сохранить точку', variant: 'destructive' });
      }
    },
    [placementId, bot.id, load, toast]
  );

  const active = orders.filter((o) => ACTIVE_STATUSES.includes(o.status));
  const archive = orders.filter((o) => ARCHIVE_STATUSES.includes(o.status));
  const newCount = orders.filter((o) => o.status === 'new').length;

  const filtered = (list: OrderDto[]) => {
    let r = list;
    if (typeFilter !== 'all') r = r.filter((o) => o.type === typeFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      r = r.filter(
        (o) =>
          String(o.number).includes(q) ||
          (o.address ?? '').toLowerCase().includes(q) ||
          (o.clientName ?? '').toLowerCase().includes(q) ||
          (o.phone ?? '').toLowerCase().includes(q)
      );
    }
    return r;
  };

  const withoutGeo = orders.filter(
    (o) => o.lat == null && ACTIVE_STATUSES.includes(o.status)
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Хедер */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} aria-label="Назад">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <MapPin className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold">Заявки</h1>
        <Badge variant="secondary" className="max-w-[180px] truncate">
          {bot.name}
        </Badge>
        {newCount > 0 && (
          <Badge variant="destructive" className="animate-pulse">
            новых: {newCount}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Обновить</span>
          </Button>
          <Button size="sm" className="h-8" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" /> Заявка
          </Button>
        </div>
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="h-9">
            <TabsTrigger value="map" className="text-xs">
              <MapPin className="mr-1 h-3.5 w-3.5" /> Карта
            </TabsTrigger>
            <TabsTrigger value="active" className="text-xs">
              Активные <span className="ml-1 text-muted-foreground">{active.length}</span>
            </TabsTrigger>
            <TabsTrigger value="archive" className="text-xs">
              <Archive className="mr-1 h-3.5 w-3.5" /> Архив{' '}
              <span className="ml-1 text-muted-foreground">{archive.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as 'all' | 'waste' | 'kgm')}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="waste">🚛 отходы</SelectItem>
            <SelectItem value="kgm">📦 КГМ</SelectItem>
          </SelectContent>
        </Select>
        {tab === 'map' && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
              className="accent-emerald-600"
            />
            выполненные на карте
          </label>
        )}
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="№, адрес, клиент, телефон…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Контент */}
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        {tab === 'map' && (
          <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto md:overflow-hidden">
            <div className="min-h-[380px] flex-1">
              <OrdersMap
                orders={filtered(orders)}
                showCompleted={showCompleted}
                placementOrderId={placementId}
                onSelect={openOrder}
                onPlace={placeOnMap}
              />
            </div>
            {withoutGeo.length > 0 && (
              <div className="rounded-xl border bg-background p-2.5">
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Без координат — укажите точку на карте:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {withoutGeo.slice(0, 8).map((o) => (
                    <button
                      key={o.id}
                      onClick={() => placeRequest(o.id)}
                      className="rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted"
                    >
                      <Crosshair className="mr-1 inline h-3 w-3" />№{o.number} ·{' '}
                      {o.address?.slice(0, 30) ?? 'без адреса'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab !== 'map' && (
          <div className="h-full overflow-y-auto pr-1">
            {loading ? (
              <div className="flex items-center gap-2 p-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
              </div>
            ) : filtered(tab === 'active' ? active : archive).length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                {tab === 'active' ? <MapPin className="h-10 w-10 opacity-30" /> : <Archive className="h-10 w-10 opacity-30" />}
                <p className="text-sm">
                  {tab === 'active'
                    ? 'Активных заявок нет. Клиенты оформляют заявки в боте — или создайте вручную.'
                    : 'Архив пуст: выполненные и отменённые заявки появятся здесь.'}
                </p>
              </div>
            ) : (
              <div className="grid gap-2 lg:grid-cols-2">
                {filtered(tab === 'active' ? active : archive).map((o) => (
                  <OrderRow key={o.id} order={o} onOpen={openOrder} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <OrderDetailDialog
        botId={bot.id}
        orderId={selectedId}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSwitchOrder={openOrder}
        onPlaceRequest={placeRequest}
        onDataChanged={load}
      />
      <NewOrderDialog
        botId={bot.id}
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={load}
      />
    </div>
  );
}

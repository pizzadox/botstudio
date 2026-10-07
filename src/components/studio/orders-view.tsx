'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl';
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  Crosshair,
  Globe,
  Headset,
  List,
  Loader2,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Truck,
  User,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import { cityButtons, composeAddress, SERVICE_CITIES } from '@/lib/cities';
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
import { Skeleton } from '@/components/ui/skeleton';
import { MytkoBadge } from '@/components/studio/mytko-badge';
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
  mytkoEnabled,
  placementOrderId,
  selectedId,
  focusOrderId,
  focusTick,
  onSelect,
  onPlace,
  onHighlight,
}: {
  orders: OrderDto[];
  showCompleted: boolean;
  mytkoEnabled: boolean;
  placementOrderId: string | null;
  selectedId: string | null;
  focusOrderId: string | null;
  focusTick: number;
  onSelect: (id: string) => void;
  onPlace: (lat: number, lng: number) => void;
  /** Выделить заявку без открытия карточки (клик по списку точек) */
  onHighlight: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const mlRef = useRef<typeof import('maplibre-gl') | null>(null);
  /** маркеры по id заявки — чтобы сдвигать их при «spiderfy» совпадающих точек */
  const markersRef = useRef<Map<string, MlMarker>>(new Map());
  /** исходные координаты заявки (без сдвига) — для пересчёта раскладки на каждом move */
  const baseCoordsRef = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [listOpen, setListOpen] = useState(false);

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
          center: [32.3, 58.35], // Новгородская область (Великий Новгород — Боровичи — Валдай)
          zoom: 7,
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

  /**
   * «Spiderfy» совпадающих точек: несколько заявок с одним адресом геокодятся
   * в идентичные координаты и ложатся маркерами друг на друга — видна только
   * одна. Группируем их по округлённым координатам и раскладываем кружком
   * с ПОСТОЯННЫМ пиксельным радиусом (пересчёт на каждом move/zoom), чтобы
   * все точки были видны и кликабельны на любом масштабе карты.
   */
  const spreadMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    // группы совпадающих координат (6 знаков ≈ 0.1 м — попадают и «почти равные»)
    const groups = new Map<string, string[]>();
    for (const [id, c] of baseCoordsRef.current) {
      const key = `${c.lat.toFixed(6)}|${c.lng.toFixed(6)}`;
      const g = groups.get(key);
      if (g) g.push(id);
      else groups.set(key, [id]);
    }

    const zoom = map.getZoom();
    // пикселей на градус долготы в Web Mercator (тайл MapLibre = 512px!)
    const pxPerDegLng = 512 * Math.pow(2, zoom) / 360;
    const SPREAD_PX = 44; // диаметр раскладки вокруг истинной точки

    for (const ids of groups.values()) {
      const n = ids.length;
      ids.forEach((id, i) => {
        const marker = markersRef.current.get(id);
        const base = baseCoordsRef.current.get(id);
        if (!marker || !base) return;
        if (n === 1) {
          marker.setLngLat([base.lng, base.lat]);
          return;
        }
        // равномерно по окружности; при 2 точках — слева и справа от истинной
        const angle = (2 * Math.PI * i) / n + (n === 2 ? Math.PI / 2 : Math.PI / 6);
        const dxPx = Math.cos(angle) * (SPREAD_PX / 2);
        const dyPx = Math.sin(angle) * (SPREAD_PX / 2);
        const dLng = dxPx / pxPerDegLng;
        const dLat = (dyPx / pxPerDegLng) * Math.cos((base.lat * Math.PI) / 180);
        marker.setLngLat([base.lng + dLng, base.lat + dLat]);
      });
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml || !ready) return;
    for (const m of markersRef.current.values()) m.remove();
    markersRef.current = new Map();
    baseCoordsRef.current = new Map();
    for (const o of visible) {
      const el = document.createElement('button');
      el.type = 'button';
      el.title = `Заявка №${o.number} — ${ORDER_TYPE_LABELS[o.type] ?? ''}`;
      // Без hover:scale — масштабирование сдвигает маркер и «прыгает»;
      // подсвечиваем тенью и рамкой, размер элемента не меняется
      el.className = cn(
        'flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 text-[11px] font-bold text-white shadow-md transition-[box-shadow,filter,border-color] hover:shadow-xl hover:brightness-110',
        markerColor(o),
        o.id === selectedId ? 'border-primary ring-2 ring-primary/50' : 'border-white'
      );
      el.textContent = String(o.number);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelect(o.id);
      });
      const marker = new ml.Marker({ element: el })
        .setLngLat([o.lng as number, o.lat as number])
        .addTo(map);
      markersRef.current.set(o.id, marker);
      baseCoordsRef.current.set(o.id, { lat: o.lat as number, lng: o.lng as number });
    }
    // раскладываем совпадающие точки и обновляем раскладку при движении/зуме
    spreadMarkers();
    map.on('move', spreadMarkers);
    return () => {
      map.off('move', spreadMarkers);
    };
    // зависимость — сериализованный список видимых маркеров
  }, [ready, visible.map((o) => `${o.id}:${o.lat}:${o.lng}:${o.status}`).join('|'), selectedId, spreadMarkers]);

  // Наведение на заявку из списка/карточки: перелетаем к точке (focusTick —
  // чтобы повторный клик по той же заявке тоже срабатывал)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusOrderId) return;
    const o = visible.find((x) => x.id === focusOrderId);
    if (!o || o.lat == null || o.lng == null) return;
    map.flyTo({ center: [o.lng, o.lat], zoom: Math.max(map.getZoom(), 15), duration: 800 });
  }, [ready, focusOrderId, focusTick]);

  // Во время режима указания точки список скрываем (баннер занимает то же место)
  useEffect(() => {
    if (placementOrderId) setListOpen(false);
  }, [placementOrderId]);

  // Переход к точке из списка: перелёт + выделение, без открытия карточки
  const jumpToListPoint = useCallback(
    (o: OrderDto) => {
      const map = mapRef.current;
      if (!map || o.lat == null || o.lng == null) return;
      onHighlight(o.id);
      map.flyTo({ center: [o.lng, o.lat], zoom: Math.max(map.getZoom(), 15), duration: 800 });
      setListOpen(false);
    },
    [onHighlight]
  );

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
    <div className="relative h-full min-h-[380px] overflow-hidden rounded-xl border bg-muted/30">
      <div ref={containerRef} className="h-full w-full" aria-label="Карта заявок" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаю карту OpenFreeMap…
        </div>
      )}
      {/* Легенда (компактная, не перекрывает атрибуцию и контролы) */}
      <div className="absolute bottom-2.5 left-2.5 z-10 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-lg border bg-background/95 px-2.5 py-1.5 text-[10px] leading-tight shadow-sm backdrop-blur sm:bottom-3 sm:left-3 sm:text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> отходы
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> КГМ
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400" /> выполненные
        </span>
      </div>
      {/* Счётчик маркеров + кнопка разворачиваемого списка точек */}
      <div className="absolute left-2.5 top-2.5 z-10 flex items-start gap-2 sm:left-3 sm:top-3">
        <div
          role="status"
          aria-label={`Точек на карте: ${visible.length}`}
          className="rounded-lg border bg-background/95 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur"
        >
          <MapPin className="mr-1 inline h-3 w-3 text-primary" aria-hidden />
          На карте: <b className="tabular-nums">{visible.length}</b>
        </div>
        {!placementOrderId && visible.length > 0 && (
          <button
            type="button"
            onClick={() => setListOpen((v) => !v)}
            aria-expanded={listOpen}
            className={cn(
              'flex items-center gap-1 rounded-lg border bg-background/95 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur transition-colors hover:bg-muted',
              listOpen && 'bg-muted'
            )}
          >
            <List className="h-3 w-3 text-primary" />
            Список
            <ChevronDown
              className={cn('h-3 w-3 transition-transform duration-200', listOpen && 'rotate-180')}
            />
          </button>
        )}
      </div>
      {/* Разворачиваемый список точек: клик — перелёт к маркеру */}
      {listOpen && (
        <div className="absolute inset-x-2.5 top-12 z-20 flex max-h-[62%] flex-col overflow-hidden rounded-xl border bg-background/95 shadow-lg backdrop-blur sm:inset-x-auto sm:left-3 sm:top-12 sm:w-[340px]">
          <div className="flex items-center justify-between border-b px-3 py-2 text-[11px] font-medium text-muted-foreground">
            <span>Точки на карте ({visible.length}) — нажмите для перехода</span>
            <button
              type="button"
              onClick={() => setListOpen(false)}
              className="rounded px-1 text-[11px] transition-colors hover:bg-muted hover:text-foreground"
            >
              Скрыть
            </button>
          </div>
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
            {visible.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => jumpToListPoint(o)}
                  className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-2.5 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    o.id === selectedId && 'bg-primary/5'
                  )}
                  aria-label={`Перейти к заявке №${o.number} — ${o.address || o.city || 'без адреса'}`}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white',
                      markerColor(o)
                    )}
                  >
                    {o.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {ORDER_TYPE_ICONS[o.type]} {o.address || o.city || 'Без адреса'}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {[o.city, o.clientName, o.wishDate].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <Badge
                    variant="outline"
                    className={cn('h-4 shrink-0 px-1 text-[9px]', ORDER_STATUS_BADGES[o.status])}
                  >
                    {ORDER_STATUS_LABELS[o.status] ?? o.status}
                  </Badge>
                  {mytkoEnabled && <MytkoBadge status={o.mytkoStatus} />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {placementOrderId && (
        <div className="absolute inset-x-2.5 top-12 z-20 flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-md sm:inset-x-auto sm:right-auto sm:left-3 sm:top-12">
          <span className="flex items-center gap-1.5">
            <Crosshair className="h-3.5 w-3.5 shrink-0" /> Кликните по карте — точка заявки №
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
      {/* Чат с клиентом по заявке */}
      <div ref={scrollRef} aria-live="polite" className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 p-3">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden>
              <MessageSquare className="h-5 w-5" />
            </div>
            <p className="text-xs">
              Сообщений по заявке пока нет.
              <br />
              Клиент может написать в боте, открыв карточку своей заявки.
            </p>
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
                <div className="text-right text-[10px] opacity-60">
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
        className="flex items-center gap-2 border-t p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Input
          aria-label="Ответ клиенту"
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
  onShowOnMap,
  onDataChanged,
  mytkoEnabled,
}: {
  botId: string;
  orderId: string | null;
  open: boolean;
  onClose: () => void;
  onSwitchOrder: (id: string) => void;
  onPlaceRequest: (orderId: string) => void;
  onShowOnMap: (orderId: string) => void;
  onDataChanged: () => void;
  mytkoEnabled: boolean;
}) {
  const { toast } = useToast();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [clientOrders, setClientOrders] = useState<OrderDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [address, setAddress] = useState('');
  const [wishDate, setWishDate] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [confirmGeo, setConfirmGeo] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mytkoBusy, setMytkoBusy] = useState(false);

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
      setAddress(d.order.address ?? '');
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
      setConfirmGeo(false);
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

  /**
   * Геокодирование адреса. Ручная точка защищена: если координаты ставили
   * вручную — сначала подтверждение; если адрес не нашёлся — прежние
   * координаты остаются (не «слетают»).
   */
  const runGeocode = async () => {
    if (!orderId || !order) return;
    setConfirmGeo(false);
    setGeoLoading(true);
    try {
      const d = await api<{ order: OrderDto; geo?: { ok: boolean; lat?: number; lng?: number } }>(
        `/api/bots/${botId}/orders/${orderId}`,
        { method: 'PATCH', body: JSON.stringify({ geocode: true }) }
      );
      setOrder(d.order);
      onDataChanged();
      if (d.geo?.ok) {
        toast({
          title: `Координаты обновлены: ${d.geo.lat?.toFixed(5)}, ${d.geo.lng?.toFixed(5)}`,
        });
      } else if (d.order.lat != null) {
        toast({
          title: 'Адрес не найден на карте',
          description: 'Прежние координаты сохранены без изменений',
        });
      } else {
        toast({
          title: 'Адрес не найден на карте',
          description: 'Уточните адрес или укажите точку кнопкой «Указать на карте»',
          variant: 'destructive',
        });
      }
    } catch {
      toast({ title: 'Ошибка геокодирования', variant: 'destructive' });
    } finally {
      setGeoLoading(false);
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

  /** Синхронизация заявки с MyTKO: токен + сверка с отчётами водителей */
  const syncMytko = async () => {
    if (!orderId) return;
    setMytkoBusy(true);
    try {
      const d = await api<{ ok: boolean; order: OrderDto }>(
        `/api/bots/${botId}/orders/${orderId}/mytko`,
        { method: 'POST' }
      );
      setOrder(d.order);
      onDataChanged();
      if (d.order.mytkoStatus === 'synced') {
        toast({ title: 'Синхронизировано с MyTKO ✅', description: d.order.mytkoInfo ?? undefined });
      } else {
        toast({
          title: 'Ошибка синхронизации с MyTKO',
          description: d.order.mytkoError ?? undefined,
          variant: 'destructive',
        });
      }
    } catch (e) {
      toast({ title: 'Ошибка синхронизации', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setMytkoBusy(false);
    }
  };

  const hasManualPoint = order?.geoSource === 'manual';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="grid h-[100dvh] w-screen max-w-none grid-rows-[auto_1fr] gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[92dvh] sm:w-[calc(100%-2rem)] sm:max-w-4xl sm:rounded-xl sm:border md:h-[85vh]">
        <DialogHeader className="border-b px-4 py-3 pr-14 md:pl-5 md:pr-16">
          <DialogTitle className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-base">
            <span className="shrink-0 text-lg">{order ? ORDER_TYPE_ICONS[order.type] : '📋'}</span>
            <span className="min-w-0 flex-1 truncate">
              {order ? `Заявка №${order.number} — ${ORDER_TYPE_LABELS[order.type] ?? ''}` : 'Заявка'}
            </span>
            {order && (
              <Badge
                variant="outline"
                className={cn('shrink-0 text-[10px]', ORDER_STATUS_BADGES[order.status])}
              >
                {ORDER_STATUS_LABELS[order.status] ?? order.status}
              </Badge>
            )}
            {mytkoEnabled && order && <MytkoBadge status={order.mytkoStatus} className="text-[10px] h-5" />}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Карточка заявки: данные клиента, статус и встроенный чат
          </DialogDescription>
        </DialogHeader>

        {!order && loading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground" role="status">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Загрузка…
          </div>
        ) : !order ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground">
            Заявка не найдена
          </div>
        ) : (
          <div className="min-h-0 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))] md:grid md:grid-cols-2 md:overflow-hidden md:pb-0">
            {/* Левая колонка: клиент + данные заявки */}
            <div className="min-h-0 space-y-4 border-b p-4 md:border-b-0 md:border-r md:overflow-y-auto">
              {/* Клиент */}
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <User className="h-3.5 w-3.5" /> Карточка клиента
                  </h3>
                  {order.conversation && (
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                        SOURCE_COLORS[order.conversation.source] ?? 'bg-muted text-muted-foreground'
                      )}
                    >
                      {SOURCE_LABELS[order.conversation.source] ?? order.conversation.source}
                    </span>
                  )}
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  <div className="break-words font-medium">
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
                    <div className="break-all text-xs text-muted-foreground">
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
                          aria-label={`Перейти к заявке №${o.number}`}
                          className={cn(
                            'flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            o.id === order.id && 'border-primary/50 bg-primary/5'
                          )}
                        >
                          <span className="shrink-0 font-semibold tabular-nums">№{o.number}</span>
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
                          {mytkoEnabled && <MytkoBadge status={o.mytkoStatus} />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Данные заявки */}
              <div className="space-y-3 rounded-xl border p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-muted-foreground">Статус</Label>
                    <Select
                      value={order.status}
                      onValueChange={(v) => patch({ status: v }, 'Статус обновлён')}
                    >
                      <SelectTrigger className="h-9 w-full">
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
                    <Label className="text-xs font-medium text-muted-foreground">Желаемая дата</Label>
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
                  <Label className="text-xs font-medium text-muted-foreground">Исполнитель</Label>
                  <div className="flex gap-2">
                    <Input
                      className="h-9 min-w-0"
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
                  <Label className="text-xs font-medium text-muted-foreground">Город и адрес вывоза</Label>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,190px)_minmax(0,1fr)]">
                    <Select
                      value={order.city ?? '__none'}
                      onValueChange={(v) =>
                        patch({ city: v === '__none' ? null : v }, 'Город обновлён')
                      }
                    >
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue placeholder="Город" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Город не указан</SelectItem>
                        {SERVICE_CITIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      className="h-9"
                      value={address}
                      placeholder="Улица, дом"
                      onChange={(e) => setAddress(e.target.value)}
                      onBlur={() => {
                        if (address !== (order.address ?? '')) patch({ address }, 'Адрес обновлён');
                      }}
                      disabled={saving}
                    />
                  </div>
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
                    {order.lat != null && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => onShowOnMap(order.id)}
                      >
                        <MapPin className="h-3.5 w-3.5" /> Показать на карте
                      </Button>
                    )}
                    {hasManualPoint && !confirmGeo ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={geoLoading || saving}
                        onClick={() => setConfirmGeo(true)}
                      >
                        <Globe className="h-3.5 w-3.5" /> Геокодировать
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={geoLoading || saving || !address.trim()}
                        onClick={runGeocode}
                      >
                        {geoLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Globe className="h-3.5 w-3.5" />
                        )}
                        Геокодировать
                      </Button>
                    )}
                  </div>
                  {confirmGeo && (
                    <div className="flex flex-col gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 sm:flex-row sm:items-center" role="alert">
                      <span className="min-w-0 flex-1">
                        Точка установлена вручную. Пересчитать координаты по адресу?
                      </span>
                      <span className="flex shrink-0 gap-1.5 sm:ml-auto">
                        <Button size="sm" className="h-7" onClick={runGeocode}>
                          Заменить
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7"
                          onClick={() => setConfirmGeo(false)}
                        >
                          Оставить
                        </Button>
                      </span>
                    </div>
                  )}
                  {order.lat != null ? (
                    <div className="pt-1 text-[11px] tabular-nums text-muted-foreground">
                      Координаты: {order.lat.toFixed(5)}, {order.lng?.toFixed(5)}
                      {order.geoSource === 'manual' && ' · указано вручную'}
                      {order.geoSource === 'geocode' && ' · по адресу'}
                    </div>
                  ) : (
                    <div className="pt-1 text-[11px] text-amber-600 dark:text-amber-400">
                      Точка на карте не указана
                    </div>
                  )}
                </div>
                {/* MyTKO «Чистая логистика» */}
                {mytkoEnabled && (
                  <div className="space-y-1.5 rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Truck className="h-3.5 w-3.5" /> MyTKO · синхронизация
                      </h3>
                      <MytkoBadge status={order.mytkoStatus} className="h-5 px-1.5 text-[10px]" />
                    </div>
                    {order.mytkoInfo && <p className="break-words text-xs text-muted-foreground">{order.mytkoInfo}</p>}
                    {order.mytkoError && (
                      <p className="break-words text-xs font-medium text-destructive">Ошибка: {order.mytkoError}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={mytkoBusy}
                        onClick={syncMytko}
                      >
                        {mytkoBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Синхронизировать с MyTKO
                      </Button>
                      {order.mytkoSyncAt && (
                        <span className="text-[11px] text-muted-foreground">
                          последняя сверка: {fmtDate(order.mytkoSyncAt)}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">Состав / объём</Label>
                  <div className="break-words text-sm">{order.size || '—'}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">Комментарий оператора</Label>
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
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
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

            {/* Правая колонка: встроенный чат с пользователем.
                На мобильных — фиксированная высота (иначе область сообщений схлопывается),
                на десктопе — занимает всю высоту колонки. */}
            <div className="flex h-[46dvh] min-h-[300px] flex-col md:h-auto md:min-h-0 md:overflow-hidden">
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
  const OTHER_CITY = '__other';
  const [form, setForm] = useState({
    type: 'waste',
    clientName: '',
    phone: '',
    city: cityButtons()[0] ?? '',
    cityOther: '',
    street: '',
    size: '',
    wishDate: '',
    comment: '',
  });

  const submit = async () => {
    const city = (form.city === OTHER_CITY ? form.cityOther : form.city).trim();
    const address = composeAddress(city, form.street);
    if (!address.trim() && !form.clientName.trim()) {
      toast({ title: 'Укажите хотя бы адрес или имя клиента', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await api(`/api/bots/${botId}/orders`, {
        method: 'POST',
        body: JSON.stringify({
          type: form.type,
          clientName: form.clientName,
          phone: form.phone,
          city,
          address,
          size: form.size,
          wishDate: form.wishDate,
          comment: form.comment,
        }),
      });
      toast({ title: 'Заявка создана — координаты подбираются автоматически' });
      setForm({
        type: 'waste',
        clientName: '',
        phone: '',
        city: cityButtons()[0] ?? '',
        cityOther: '',
        street: '',
        size: '',
        wishDate: '',
        comment: '',
      });
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
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новая заявка</DialogTitle>
          <DialogDescription>
            Заявку можно создать вручную — она появится на карте и в списке. Координаты подставятся автоматически по адресу.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Тип</Label>
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
              <Label className="text-xs font-medium text-muted-foreground">Телефон</Label>
              <Input
                value={form.phone}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+7 900 …"
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground">Клиент</Label>
            <Input
              value={form.clientName}
              placeholder="Имя клиента"
              onChange={(e) => setForm({ ...form, clientName: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Город обслуживания</Label>
              <Select
                value={form.city}
                onValueChange={(v) => setForm({ ...form, city: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Выберите город" />
                </SelectTrigger>
                <SelectContent>
                  {[...cityButtons(), ...SERVICE_CITIES.slice(cityButtons().length)].map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER_CITY}>Другой…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">
                {form.city === OTHER_CITY ? 'Название города' : 'Улица и дом'}
              </Label>
              {form.city === OTHER_CITY ? (
                <div className="flex flex-col gap-2">
                  <Input
                    value={form.cityOther}
                    placeholder="Например: Чудово"
                    onChange={(e) => setForm({ ...form, cityOther: e.target.value })}
                  />
                  <Input
                    value={form.street}
                    placeholder="Улица и дом"
                    onChange={(e) => setForm({ ...form, street: e.target.value })}
                  />
                </div>
              ) : (
                <Input
                  value={form.street}
                  placeholder="Улица и дом"
                  onChange={(e) => setForm({ ...form, street: e.target.value })}
                />
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Объём / состав</Label>
              <Input
                value={form.size}
                placeholder="8 м³, диван…"
                onChange={(e) => setForm({ ...form, size: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Дата подачи</Label>
              <Input
                value={form.wishDate}
                placeholder="завтра до 12:00"
                onChange={(e) => setForm({ ...form, wishDate: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground">Комментарий</Label>
            <Textarea
              rows={2}
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Создаю…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" aria-hidden /> Создать заявку
                </>
              )}
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
  mytkoEnabled,
}: {
  order: OrderDto;
  onOpen: (id: string) => void;
  mytkoEnabled: boolean;
}) {
  return (
    <button
      onClick={() => onOpen(order.id)}
      aria-label={`Открыть заявку №${order.number} — ${order.address || order.clientName || 'без адреса'}`}
      className={cn(
        'flex w-full flex-col gap-1.5 rounded-xl border bg-card p-3 text-left shadow-sm transition-[box-shadow,background-color] hover:bg-muted/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        order.status === 'new' && 'border-amber-300/70 dark:border-amber-500/40'
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
        {mytkoEnabled && <MytkoBadge status={order.mytkoStatus} />}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-10 text-[11px] text-muted-foreground">
        {order.clientName && <span className="font-medium">{order.clientName}</span>}
        {order.phone && <span>{order.phone}</span>}
        {order.size && <span>{order.size}</span>}
        {order.wishDate && <span>🗓 {order.wishDate}</span>}
        {order.lat != null ? (
          <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
            <MapPin className="h-3 w-3" aria-hidden /> на карте
          </span>
        ) : (
          <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
            <MapPin className="h-3 w-3" aria-hidden /> точка не указана
          </span>
        )}
        {typeof order.messagesCount === 'number' && order.messagesCount > 0 && (
          <span className="flex items-center gap-0.5">
            <MessageSquare className="h-3 w-3" /> {order.messagesCount}
          </span>
        )}
        <span className="ml-auto tabular-nums">{fmtDate(order.createdAt)}</span>
      </div>
    </button>
  );
}

// ─── Главный вид раздела «Заявки» ────────────────────────────────────────────

export default function OrdersView({
  bot,
  onBack,
  focusOrderId,
  onFocusConsumed,
}: {
  bot: { id: string; name: string };
  onBack: () => void;
  /** id заявки из уведомления — открыть карту и подсветить её точку */
  focusOrderId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const { toast } = useToast();
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [placementId, setPlacementId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; tick: number } | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);
  const [typeFilter, setTypeFilter] = useState<'all' | 'waste' | 'kgm'>('all');
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [mytkoEnabled, setMytkoEnabled] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ orders: OrderDto[]; mytkoEnabled?: boolean }>(`/api/bots/${bot.id}/orders`);
      setOrders(d.orders);
      setMytkoEnabled(!!d.mytkoEnabled);
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

  // Переход из уведомления: карта + подсветка точки (без карточки);
  // выполненные заявки тоже показываем, иначе маркер мог бы быть скрыт
  useEffect(() => {
    if (!focusOrderId) return;
    setShowCompleted(true);
    setTab('map');
    setPlacementId(null);
    setDialogOpen(false);
    setSelectedId(focusOrderId);
    setFocus((f) => ({ id: focusOrderId, tick: (f?.tick ?? 0) + 1 }));
    onFocusConsumed?.();
  }, [focusOrderId, onFocusConsumed]);

  // Закрыть карточку и перелететь к точке заявки на карте
  const showOnMap = useCallback((id: string) => {
    setDialogOpen(false);
    setSelectedId(null);
    setPlacementId(null);
    setTab('map');
    setFocus((f) => ({ id, tick: (f?.tick ?? 0) + 1 }));
  }, []);

  const placeRequest = useCallback(
    (orderId: string) => {
      const order = orders.find((o) => o.id === orderId);
      setDialogOpen(false);
      setSelectedId(null);
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
        const d = await api<{ order: OrderDto }>(`/api/bots/${bot.id}/orders/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ lat, lng }),
        });
        toast({
          title: 'Точка заявки сохранена на карте',
          description: d.order?.address
            ? `Адрес обновлён: ${d.order.address}`
            : 'Адрес не удалось определить — точка сохранена',
        });
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
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2.5 sm:px-4 sm:py-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onBack} aria-label="Назад к дашборду">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <MapPin className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        <h1 className="shrink-0 text-lg font-bold tracking-tight sm:text-xl">Заявки</h1>
        <Badge variant="secondary" className="max-w-[130px] truncate sm:max-w-[180px]">
          {bot.name}
        </Badge>
        {newCount > 0 && (
          <Badge variant="destructive" className="tabular-nums animate-pulse" aria-label={`Новых заявок: ${newCount}`}>
            новых: {newCount}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={load} aria-label="Обновить список заявок">
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Обновить</span>
          </Button>
          <Button size="sm" className="h-8" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Новая</span> Заявка
          </Button>
        </div>
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2 sm:px-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="h-9">
            <TabsTrigger value="map" className="text-xs">
              <MapPin className="mr-1 h-3.5 w-3.5" /> Карта
            </TabsTrigger>
            <TabsTrigger value="active" className="text-xs">
              Активные <span className="ml-1 tabular-nums text-muted-foreground">{active.length}</span>
            </TabsTrigger>
            <TabsTrigger value="archive" className="text-xs">
              <Archive className="mr-1 hidden h-3.5 w-3.5 sm:inline" /> Архив{' '}
              <span className="ml-1 tabular-nums text-muted-foreground">{archive.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as 'all' | 'waste' | 'kgm')}>
          <SelectTrigger className="h-9 w-[140px] sm:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="waste">🚛 отходы</SelectItem>
            <SelectItem value="kgm">📦 КГМ</SelectItem>
          </SelectContent>
        </Select>
        {tab === 'map' && (
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
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
            type="search"
            aria-label="Поиск заявок по номеру, адресу, клиенту или телефону"
            placeholder="№, адрес, клиент, телефон…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Контент */}
      <div className="min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
        {tab === 'map' && (
          <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto md:overflow-hidden">
            <div className="min-h-[340px] flex-1 sm:min-h-[380px]">
              <OrdersMap
                orders={filtered(orders)}
                showCompleted={showCompleted}
                mytkoEnabled={mytkoEnabled}
                placementOrderId={placementId}
                selectedId={selectedId}
                focusOrderId={focus?.id ?? null}
                focusTick={focus?.tick ?? 0}
                onSelect={openOrder}
                onPlace={placeOnMap}
                onHighlight={setSelectedId}
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
                      className="rounded-full border px-2.5 py-1.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      aria-label={`Указать точку заявки №${o.number} на карте`}
                    >
                      <Crosshair className="mr-1 inline h-3 w-3" aria-hidden />№{o.number} ·{' '}
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
              <div className="grid grid-cols-1 gap-2 p-1 lg:grid-cols-2" role="status" aria-label="Загрузка заявок">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-[68px] rounded-xl" />
                ))}
              </div>
            ) : filtered(tab === 'active' ? active : archive).length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                <div
                  className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"
                  aria-hidden
                >
                  {tab === 'active' ? <MapPin className="h-7 w-7" /> : <Archive className="h-7 w-7" />}
                </div>
                <p className="max-w-sm text-sm">
                  {tab === 'active'
                    ? 'Активных заявок нет. Клиенты оформляют заявки в боте — или создайте первую вручную.'
                    : 'Архив пуст: выполненные и отменённые заявки появятся здесь.'}
                </p>
                {tab === 'active' && (
                  <Button size="sm" onClick={() => setNewOpen(true)}>
                    <Plus className="h-4 w-4" aria-hidden /> Создать заявку
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {filtered(tab === 'active' ? active : archive).map((o) => (
                  <OrderRow key={o.id} order={o} onOpen={openOrder} mytkoEnabled={mytkoEnabled} />
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
        onClose={() => {
          setDialogOpen(false);
          setSelectedId(null);
        }}
        onSwitchOrder={openOrder}
        onPlaceRequest={placeRequest}
        onShowOnMap={showOnMap}
        onDataChanged={load}
        mytkoEnabled={mytkoEnabled}
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

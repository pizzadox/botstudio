'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl';
import Supercluster from 'supercluster'; // IMP-23-MAP-02: кластеризация видимых точек
import {
  Archive,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  Clock,
  Copy,
  Crosshair,
  Download,
  Globe,
  Headset,
  List,
  Loader2,
  MapPin,
  MapPinned,
  MessageCircle,
  MessageSquare,
  Phone,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Truck,
  User,
  Users,
  WifiOff,
} from 'lucide-react';
import { api, getAuthToken } from '@/lib/client-api';
import { cityButtons, composeAddress, SERVICE_CITIES } from '@/lib/cities';
import { FINAL_ORDER_STATUSES } from '@/lib/order-status'; // IMP-25-20: финальные статусы — гвард bulk
import { parseWishDate } from '@/lib/wish-date'; // IMP-25-22: превью распознавания желаемой даты
import type {
  AreaItem,
  AreaMatchCandidate,
  CrewDto,
  OrderDto,
  OrderMessageDto,
} from '@/lib/studio-types';
import {
  ORDER_STATUS_BADGES,
  ORDER_STATUS_LABELS,
  ORDER_TYPE_ICONS,
  ORDER_TYPE_LABELS,
  SOURCE_COLORS,
  SOURCE_LABELS,
} from '@/lib/studio-types';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
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
import { Checkbox } from '@/components/ui/checkbox';
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

/** Классы DOM-элемента маркера: цвет по типу/статусу + выделение выбранной заявки.
 *  Вынесено, чтобы эффект выделения мог переключать класс БЕЗ пересоздания маркера. */
function markerElClassName(o: OrderDto, selected: boolean): string {
  return cn(
    'flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 text-[11px] font-bold text-white shadow-md transition-[box-shadow,filter,border-color] hover:shadow-xl hover:brightness-110',
    markerColor(o),
    selected ? 'border-primary ring-2 ring-primary/50' : 'border-white'
  );
}

/** IMP-23-MAP-02: свойства точки в индексе supercluster */
type OrderPointProps = { orderId: string; number: number; typeKey: string };

/** IMP-25-18: свойства точки КП в supercluster-индексе (второй индекс — для КП-слоя) */
type KpPointProps = { lkCode: string };

/** IMP-25-18: проекция свойств фичи КП (union кластер|точка) */
type KpFeatureProps = ClusterishProps & { lkCode?: string };

/** IMP-23-MAP-02: проекция свойств фичи из getClusters (union кластер|точка) —
 * namespace-типы supercluster через default-import недоступны, поэтому локальные */
type ClusterishProps = {
  cluster?: true;
  cluster_id?: number;
  point_count?: number;
  orderId?: string;
};

/** IMP-23-MAP-02: классы DOM-элемента кластер-маркера — круглая primary-пилюля с числом
 *  заявок; 'orders-cluster' — стабильный семантический хук (стили/тесты) */
const CLUSTER_EL_CLASS = cn(
  'orders-cluster',
  'flex h-7 min-w-7 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-primary px-1.5 text-[11px] font-bold text-primary-foreground shadow-md',
  'transition-[box-shadow,filter] hover:shadow-xl hover:brightness-110'
);

/** IMP-24-FE1-05: DOM-элемент маркера КП — маленький ромб teal с белой рамкой.
 *  Вращение на ВНУТРЕННЕМ span: transform самого элемента занят позиционированием
 *  MapLibre. 'kp-marker' — стабильный семантический хук (стили/тесты). */
const KP_EL_CLASS = cn(
  'kp-marker group',
  'flex h-5 w-5 cursor-pointer items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
);
const KP_DIAMOND_CLASS =
  'block h-3.5 w-3.5 rotate-45 rounded-[4px] border-2 border-white bg-teal-600 shadow-md transition-[filter] group-hover:brightness-110';

/** IMP-25-18: кластер КП — teal-ромб с числом точек; размер растёт с количеством */
function kpClusterElClass(count: number): string {
  const size = count >= 100 ? 'h-9 w-9' : count >= 10 ? 'h-8 w-8' : 'h-7 w-7';
  return cn(
    'kp-cluster group relative flex cursor-pointer items-center justify-center',
    size,
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  );
}
const KP_CLUSTER_DIAMOND_CLASS =
  'pointer-events-none absolute inset-[3px] rotate-45 rounded-[5px] border-2 border-white bg-teal-600 shadow-md transition-[filter] group-hover:brightness-110';
const KP_CLUSTER_COUNT_CLASS =
  'relative text-[11px] font-bold leading-none text-white tabular-nums';

/** IMP-25-19: подсветка КП, привязанной к выбранной заявке — зелёное кольцо на маркере */
const KP_SELECTED_CLASS = 'rounded-full ring-2 ring-emerald-500 bg-emerald-500/15';

/** IMP-25-18: zoom-gate КП-слоя — при зуме ниже порога слой не грузит bbox и не рисует */
const KP_ZOOM_GATE = 11;

/** «Обновлено N с назад» для чипа свежести данных */
function fmtAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 8) return 'только что';
  if (s < 60) return `${s} с назад`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин назад`;
  return `${Math.floor(m / 60)} ч назад`;
}

/** Дедуп-слияние сообщений по id (append-only) + сортировка по createdAt.
 *  Если нового ничего нет — возвращает прежний массив (без ре-рендера).
 *  Работает в обоих режимах бэкенда: и с ?take=N, и без него. */
function mergeMessages(prev: OrderMessageDto[], incoming: OrderMessageDto[]): OrderMessageDto[] {
  if (incoming.length === 0) return prev;
  const known = new Set(prev.map((m) => m.id));
  const fresh = incoming.filter((m) => !known.has(m.id));
  if (fresh.length === 0) return prev;
  return [...prev, ...fresh].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

/** localStorage с защитой от недоступности (SSR / приватный режим) */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
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

/** FE22-02: относительная дата для мини-таймлайна заявки (старше суток — точная дата) */
function fmtRel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return fmtDate(iso);
}

/** IMP-24-FE1-03: дата подачи в ru-формате «пт, 23.10.2026» */
function formatDateRu(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    weekday: 'short',
    timeZone: 'Europe/Moscow', // IMP-25-22: чип «Забор» не уезжает на день у оператора не в MSK
  }).format(d);
}

/** IMP-25-22: pickupAt (полдень MSK в UTC) → YYYY-MM-DD московского календарного дня
 *  для input type="date" (en-CA отдаёт ISO-подобный формат) */
function pickupInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(d);
}

/** IMP-24-FE1-05: расстояние в человекочитаемом виде (<1 км — метры) */
function fmtDistanceM(m: number): string {
  if (m < 1000) return `${Math.round(m)} м`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} км`;
}

/** IMP-24-FE1-05: расстояние между точками по прямой (haversine, метры) */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** IMP-24-FE1-05: ссылка на площадку в OpenStreetMap (паттерн areas-view) */
function osmUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
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
  onFocusDone,
  onKpSelect,
  selectedAreaLkCode, // IMP-25-19: КП выбранной заявки — зелёное кольцо на маркере
  botId,
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
  /** IMP-23-MAP-01: очистить stale focus-состояние родителя после перелёта к точке */
  onFocusDone?: () => void;
  /** IMP-24-FE1-05: клик по маркеру КП реестра — открыть карточку КП */
  onKpSelect: (area: AreaItem) => void;
  /** IMP-25-19: areaLkCode выбранной заявки — подсветка привязанной КП на карте */
  selectedAreaLkCode: string | null;
  /** IMP-23-MAP-03: смена бота → первый автоподгон камеры выполняется заново (один раз) */
  botId?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const mlRef = useRef<typeof import('maplibre-gl') | null>(null);
  /** маркеры по id заявки — чтобы сдвигать их при «spiderfy» совпадающих точек */
  const markersRef = useRef<Map<string, MlMarker>>(new Map());
  /** исходные координаты заявки (без сдвига) — для пересчёта раскладки на каждом move */
  const baseCoordsRef = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  /** id → заявка: эффекту выделения, чтобы перекрашивать маркеры без пересоздания */
  const ordersByIdRef = useRef<Map<string, OrderDto>>(new Map());
  /** зеркальная копия selectedId — доступ из эффектов маркеров без их пересоздания */
  const selectedIdRef = useRef<string | null>(selectedId);
  /** IMP-23-MAP-02: кластер-маркеры по cluster_id — отдельный слой DOM-пилюль */
  const clusterMarkersRef = useRef<Map<string, MlMarker>>(new Map());
  /** IMP-23-MAP-02: актуальный индекс для кликов по пилюлям (переживает смену данных) */
  const clusterIndexRef = useRef<Supercluster<OrderPointProps> | null>(null);
  /** IMP-23-MAP-03: первый автоподгон камеры — один раз, до ручного взаимодействия */
  const autoFitDoneRef = useRef(false);
  const userMapInputRef = useRef(false);
  /** IMP-23-MAP-01: onFocusDone через ref — эффект перелёта не пересоздаётся из-за колбэка */
  const focusDoneRef = useRef(onFocusDone);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  // IMP-24-FE1-05: слой КП реестра MyTKO — СВОЙ набор DOM-маркеров (kpMarkersRef,
  // не пересекается с orders-refs: spiderfy/кластеры волны 23 КП не трогают).
  // Загрузка точек текущего вьюпорта (?bbox=), дифф-обновление по lkCode.
  const [kpEnabled, setKpEnabled] = useState(() => {
    // IMP-25-19: тумблер слоя переживает перезагрузку (bstudio.orders.kpEnabled)
    const v = typeof window === 'undefined' ? null : readStored('bstudio.orders.kpEnabled');
    return v === '1';
  });
  const [kpAreas, setKpAreas] = useState<AreaItem[]>([]);
  const [kpTotal, setKpTotal] = useState(0);
  const [kpLoading, setKpLoading] = useState(false);
  const [kpError, setKpError] = useState(false); // IMP-25-19: сбой bbox-загрузки КП
  const [kpSortOk, setKpSortOk] = useState(false); // IMP-25-18: бэк ответил на sort=dist
  /** IMP-25-18: зум ниже порога — слой не грузится (чип «Приблизьте карту») */
  const [kpGateBlocked, setKpGateBlocked] = useState(true);
  const kpMarkersRef = useRef<Map<string, MlMarker>>(new Map());
  /** IMP-25-18: кластеры КП — ромбы с числом, отдельный слой (как orders-кластеры) */
  const kpClusterMarkersRef = useRef<Map<string, MlMarker>>(new Map());
  const kpAbortRef = useRef<AbortController | null>(null);
  const kpDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** колбэк клика по КП — через ref, чтобы эффект маркеров не пересоздавался */
  const kpSelectRef = useRef(onKpSelect);
  useEffect(() => {
    kpSelectRef.current = onKpSelect;
  }, [onKpSelect]);
  /** IMP-25-19: КП выбранной заявки — ref для подсветки из колбэков рендера */
  const selectedAreaLkRef = useRef<string | null>(selectedAreaLkCode);
  // IMP-25-19: persist тумблера слоя КП
  useEffect(() => {
    writeStored('bstudio.orders.kpEnabled', kpEnabled ? '1' : '0');
  }, [kpEnabled]);

  /** Загрузка КП текущего вьюпорта: bbox = minLng,minLat,maxLng,maxLat (5 знаков).
   *  IMP-25-18: zoom-gate — ниже KP_ZOOM_GATE не запрашиваем и не рисуем;
   *  IMP-25-18: sort=dist — «ближайшие к центру кадра» (бэк волны 25), при ошибке
   *  ретрай без sort (чип честно переключается на «первые по коду в кадре»);
   *  IMP-25-19: сбой сети — чип «Не удалось загрузить КП» + «Повторить». */
  const loadKpAreas = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getZoom() < KP_ZOOM_GATE) {
      // zoom-gate: данные не запрашиваем, отрисовку и pending-загрузку гасим
      kpAbortRef.current?.abort();
      setKpGateBlocked(true);
      setKpError(false);
      setKpLoading(false);
      setKpAreas((prev) => (prev.length ? [] : prev)); // kpTotal сохраняем — для честной подсказки «~N КП»
      for (const m of kpMarkersRef.current.values()) m.remove();
      kpMarkersRef.current.clear();
      for (const m of kpClusterMarkersRef.current.values()) m.remove();
      kpClusterMarkersRef.current.clear();
      return;
    }
    setKpGateBlocked(false);
    kpAbortRef.current?.abort();
    const ac = new AbortController();
    kpAbortRef.current = ac;
    setKpLoading(true);
    setKpError(false);
    const b = map.getBounds();
    const bbox = [
      b.getWest().toFixed(5),
      b.getSouth().toFixed(5),
      b.getEast().toFixed(5),
      b.getNorth().toFixed(5),
    ].join(',');
    const url = (sorted: boolean) =>
      `/api/bots/${botId}/mytko/areas?bbox=${bbox}${sorted ? '&sort=dist' : ''}`;
    try {
      let d: { items: AreaItem[]; total: number };
      try {
        d = await api<{ items: AreaItem[]; total: number }>(url(true), { signal: ac.signal });
        setKpSortOk(true);
      } catch (e) {
        if (ac.signal.aborted) throw e; // отмена — не ошибка и не повод для ретрая
        // бэк ещё не умеет sort=dist (или сбой) — повторяем по старому контракту
        d = await api<{ items: AreaItem[]; total: number }>(url(false), { signal: ac.signal });
        setKpSortOk(false);
      }
      if (ac.signal.aborted) return;
      setKpAreas(d.items ?? []);
      setKpTotal(d.total ?? d.items?.length ?? 0);
    } catch {
      if (ac.signal.aborted) return; // отмена — молча
      setKpError(true); // IMP-25-19: не глотаем — чип с кнопкой «Повторить»
    } finally {
      // IMP-25-19: сброс kpLoading и при abort — «висящий» скелетон недопустим.
      // Управляет только АКТУАЛЬНАЯ загрузка (ref уже мог указывать на новую).
      if (kpAbortRef.current === ac) setKpLoading(false);
    }
  }, [botId]);

  // Включение слоя — загрузка по текущему bbox (с zoom-gate); выключение — снять все
  // КП-маркеры/кластеры и отменить pending-загрузку (AbortController + debounce)
  useEffect(() => {
    if (!ready) return;
    if (kpEnabled) {
      void loadKpAreas();
    } else {
      kpAbortRef.current?.abort();
      if (kpDebounceRef.current) clearTimeout(kpDebounceRef.current);
      for (const m of kpMarkersRef.current.values()) m.remove();
      kpMarkersRef.current.clear();
      for (const m of kpClusterMarkersRef.current.values()) m.remove(); // IMP-25-18
      kpClusterMarkersRef.current.clear();
      setKpAreas([]);
      setKpTotal(0);
      setKpLoading(false);
      setKpError(false); // IMP-25-19
    }
  }, [ready, kpEnabled, loadKpAreas]);

  // IMP-24-REV-5: смена бота — точки чужого реестра не должны переживать переход
  useEffect(() => {
    kpAbortRef.current?.abort();
    setKpAreas([]);
    setKpTotal(0);
    setKpError(false); // IMP-25-19
    for (const m of kpMarkersRef.current.values()) m.remove();
    kpMarkersRef.current.clear();
    for (const m of kpClusterMarkersRef.current.values()) m.remove(); // IMP-25-18
    kpClusterMarkersRef.current.clear();
  }, [botId]);

  // IMP-24-REV-5: размонтирование карты — отменяем pending-загрузку и снимаем маркеры
  useEffect(() => {
    return () => {
      kpAbortRef.current?.abort();
      if (kpDebounceRef.current) clearTimeout(kpDebounceRef.current);
      for (const m of kpMarkersRef.current.values()) m.remove();
      kpMarkersRef.current.clear();
      for (const m of kpClusterMarkersRef.current.values()) m.remove(); // IMP-25-18
      kpClusterMarkersRef.current.clear();
    };
  }, []);

  // IMP-25-18: индекс supercluster по КП-точкам (второй индекс — паттерн заявок
  // волны 23): близкие ромбы объединяются в кластеры, DOM-маркеры создаются только
  // для видимых одиночных точек. Пересобирается при смене набора (bbox-загрузка).
  const kpIndex = useMemo(() => {
    const pts = kpAreas
      .filter((a) => a.lat != null && a.lng != null)
      .map((a) => ({
        type: 'Feature' as const,
        properties: { lkCode: a.lkCode },
        geometry: { type: 'Point' as const, coordinates: [a.lng as number, a.lat as number] },
      }));
    if (pts.length === 0) return null;
    return new Supercluster<KpPointProps>({ radius: 48, maxZoom: 16, minPoints: 3 }).load(pts);
  }, [kpAreas]);

  // Актуальный индекс для кликов по кластерам КП (переживает смену данных)
  const kpIndexRef = useRef<Supercluster<KpPointProps> | null>(null);
  useEffect(() => {
    kpIndexRef.current = kpIndex;
  }, [kpIndex]);

  /** IMP-25-18: кластерный рендер КП-слоя (обновление по moveend, как у заявок).
   *  Одиночные КП — дифф по lkCode (создаём только недостающие), кластеры —
   *  дифф по cluster_id с числом точек; ниже KP_ZOOM_GATE слой пуст (zoom-gate). */
  const renderKpClusters = useCallback(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml || !ready || !kpEnabled) return;

    // zoom-gate: ниже порога ничего не рисуем (и не грузим — см. loadKpAreas)
    if (map.getZoom() < KP_ZOOM_GATE) {
      for (const m of kpMarkersRef.current.values()) m.remove();
      kpMarkersRef.current.clear();
      for (const m of kpClusterMarkersRef.current.values()) m.remove();
      kpClusterMarkersRef.current.clear();
      return;
    }

    const zoom = Math.round(map.getZoom());
    const bbox = map.getBounds().toArray().flat() as [number, number, number, number];
    const features = kpIndex ? kpIndex.getClusters(bbox, zoom) : [];

    const nextIndividual = new Set<string>();
    const nextClusterIds = new Set<string>();

    for (const f of features) {
      const p = f.properties as KpFeatureProps;
      const [lng, lat] = f.geometry.coordinates as [number, number];
      if (p.cluster) {
        const cid = String(p.cluster_id);
        const count = p.point_count ?? 0;
        nextClusterIds.add(cid);
        const existing = kpClusterMarkersRef.current.get(cid);
        if (existing) {
          existing.setLngLat([lng, lat]);
          const el = existing.getElement();
          if (el.dataset.count !== String(count)) {
            el.dataset.count = String(count);
            el.className = kpClusterElClass(count);
            const num = el.querySelector('.kp-cluster-count');
            if (num) num.textContent = String(count);
            el.title = `${count} КП в кластере — клик раскроет точки`;
            el.setAttribute('aria-label', `Кластер из ${count} КП`);
          }
        } else {
          const el = document.createElement('button');
          el.type = 'button';
          el.dataset.count = String(count);
          el.className = kpClusterElClass(count);
          el.title = `${count} КП в кластере — клик раскроет точки`;
          el.setAttribute('aria-label', `Кластер из ${count} КП`);
          const diamond = document.createElement('span');
          diamond.setAttribute('aria-hidden', 'true');
          diamond.className = KP_CLUSTER_DIAMOND_CLASS;
          const num = document.createElement('span');
          num.className = `kp-cluster-count ${KP_CLUSTER_COUNT_CLASS}`;
          num.textContent = String(count);
          el.appendChild(diamond);
          el.appendChild(num);
          const marker = new ml.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
          // клик читает индекс/позицию В МОМЕНТ клика (ref) — переживает смену данных
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const idx = kpIndexRef.current;
            const m = mapRef.current;
            if (!idx || !m) return;
            const { lng: clng, lat: clat } = marker.getLngLat();
            // раскрытие кластера — как у заявок: зум до точки раскрытия (минимум +1)
            const expansion = idx.getClusterExpansionZoom(Number(cid));
            const target = Math.min(Math.max(expansion, m.getZoom() + 1), 18);
            m.easeTo({ center: [clng, clat], zoom: target, duration: 600 });
          });
          kpClusterMarkersRef.current.set(cid, marker);
        }
      } else if (p.lkCode) {
        nextIndividual.add(p.lkCode);
      }
    }

    // снять исчезнувшие кластеры (иначе призраки при смене зума/данных)
    for (const [cid, m] of kpClusterMarkersRef.current) {
      if (!nextClusterIds.has(cid)) {
        m.remove();
        kpClusterMarkersRef.current.delete(cid);
      }
    }

    // одиночные КП — дифф по lkCode: снимаем исчезнувшие, создаём только недостающие
    const byCode = new Map<string, AreaItem>();
    for (const a of kpAreas) {
      if (a.lat != null && a.lng != null) byCode.set(a.lkCode, a);
    }
    for (const [code, m] of kpMarkersRef.current) {
      if (!nextIndividual.has(code)) {
        m.remove();
        kpMarkersRef.current.delete(code);
      }
    }
    for (const code of nextIndividual) {
      if (kpMarkersRef.current.has(code)) continue; // уже на карте — не трогаем
      const area = byCode.get(code);
      if (!area || area.lat == null || area.lng == null) continue;
      const el = document.createElement('button');
      el.type = 'button';
      const selected = code === selectedAreaLkRef.current; // IMP-25-19
      el.dataset.kpSel = String(selected);
      el.className = selected ? `${KP_EL_CLASS} ${KP_SELECTED_CLASS}` : KP_EL_CLASS;
      el.title = `КП ${code}`;
      el.setAttribute('aria-label', `КП ${code}${area.address ? ` — ${area.address}` : ''}`);
      const diamond = document.createElement('span');
      diamond.setAttribute('aria-hidden', 'true');
      diamond.className = KP_DIAMOND_CLASS;
      el.appendChild(diamond);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        kpSelectRef.current(area);
      });
      const marker = new ml.Marker({ element: el })
        .setLngLat([area.lng, area.lat])
        .addTo(map);
      kpMarkersRef.current.set(code, marker);
    }
  }, [ready, kpEnabled, kpIndex, kpAreas]);

  // IMP-25-19: подсветка КП, привязанной к выбранной заявке — зелёное кольцо на
  // существующем маркере (класс переключается без пересоздания)
  useEffect(() => {
    selectedAreaLkRef.current = selectedAreaLkCode;
    for (const [code, m] of kpMarkersRef.current) {
      const el = m.getElement();
      const sel = code === selectedAreaLkCode;
      if (el.dataset.kpSel === String(sel)) continue;
      el.dataset.kpSel = String(sel);
      el.className = sel ? `${KP_EL_CLASS} ${KP_SELECTED_CLASS}` : KP_EL_CLASS;
    }
  }, [selectedAreaLkCode]);

  // IMP-25-19: «Перелететь к КП» из карточки КП — KpDialog — соседний компонент без
  // доступа к карте, командуем через CustomEvent (паттерн bstudio:open-conversation)
  useEffect(() => {
    const onKpEase = (e: Event) => {
      const map = mapRef.current;
      const d = (e as CustomEvent<{ lng?: number; lat?: number; zoom?: number }>).detail;
      if (!map || !d || !Number.isFinite(d.lng) || !Number.isFinite(d.lat)) return;
      map.easeTo({
        center: [d.lng as number, d.lat as number],
        zoom: d.zoom ?? 16,
        duration: 700,
      });
    };
    window.addEventListener('bstudio:kp-ease', onKpEase);
    return () => window.removeEventListener('bstudio:kp-ease', onKpEase);
  }, []);

  // IMP-25-18: на moveend — мгновенная перерисовка кластеров/zoom-gate + отложенная
  // (600мс) догрузка bbox. renderKpClusters меняется вместе с данными, поэтому
  // эффект переподписывается и сразу перерисовывает новый набор (как у заявок).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !kpEnabled) return;
    const onKpMoveEnd = () => {
      setKpGateBlocked(map.getZoom() < KP_ZOOM_GATE);
      renderKpClusters();
      if (kpDebounceRef.current) clearTimeout(kpDebounceRef.current);
      kpDebounceRef.current = setTimeout(() => void loadKpAreas(), 600);
    };
    renderKpClusters();
    map.on('moveend', onKpMoveEnd);
    return () => {
      map.off('moveend', onKpMoveEnd);
      if (kpDebounceRef.current) clearTimeout(kpDebounceRef.current);
    };
  }, [ready, kpEnabled, loadKpAreas, renderKpClusters]);

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
        // IMP-23-MAP-03: ручное взаимодействие с картой отменяет автоподгон камеры
        const markUserInput = () => {
          userMapInputRef.current = true;
        };
        map.on('mousedown', markUserInput);
        map.on('wheel', markUserInput);
        map.on('touchstart', markUserInput);
        map.on('dblclick', markUserInput);
        map.on('dragstart', markUserInput);
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
  /** IMP-23-MAP-02: сериализованный ключ видимых точек — единая зависимость диффа
   *  маркеров и кластер-индекса; поллинг с неизменёнными данными ничего не перестраивает */
  const visibleKey = visible
    .map((o) => `${o.id}:${o.lat}:${o.lng}:${o.status}:${o.type}:${o.number}`)
    .join('|');

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

  // IMP-23-MAP-02: индекс supercluster по видимым заявкам (radius 64px, до z16,
  // кластер от 3 точек). Пересобирается только при реальном изменении набора
  // (visibleKey) — поллинг с теми же данными индекс не трогает.
  const clusterIndex = useMemo(() => {
    if (visible.length === 0) return null;
    const points = visible.map((o) => ({
      type: 'Feature' as const,
      properties: { orderId: o.id, number: o.number, typeKey: `${o.status}|${o.type}` },
      geometry: { type: 'Point' as const, coordinates: [o.lng as number, o.lat as number] },
    }));
    return new Supercluster<OrderPointProps>({ radius: 64, maxZoom: 16, minPoints: 3 }).load(points);
  }, [visibleKey]);

  // ДИФФ-обновление маркеров (IMP-F10): удаляем исчезнувшие, обновляем координаты
  // и цвет существующих, добавляем только новые — поллинг больше не пересоздаёт
  // все маркеры и карта не «мигает». Выделение (selectedId) — отдельным эффектом ниже.
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml || !ready) return;

    // (a) входящий набор видимых заявок
    const incoming = new Map<string, OrderDto>();
    for (const o of visible) incoming.set(o.id, o);
    ordersByIdRef.current = incoming;

    // (b) удаляем маркеры, которых больше нет
    for (const [id, m] of markersRef.current) {
      if (!incoming.has(id)) {
        m.remove();
        markersRef.current.delete(id);
        baseCoordsRef.current.delete(id);
      }
    }

    // (c)+(d) обновляем существующие / добавляем только новые
    for (const o of visible) {
      const lat = o.lat as number;
      const lng = o.lng as number;
      baseCoordsRef.current.set(o.id, { lat, lng });
      const sig = `${o.status}|${o.type}`;
      const existing = markersRef.current.get(o.id);
      if (existing) {
        const el = existing.getElement();
        if (el.dataset.sig !== sig) {
          // статус/тип изменились — перекрашиваем без пересоздания
          el.dataset.sig = sig;
          el.className = markerElClassName(o, o.id === selectedIdRef.current);
        }
      } else {
        const el = document.createElement('button');
        el.type = 'button';
        el.dataset.sig = sig;
        el.title = `Заявка №${o.number} — ${ORDER_TYPE_LABELS[o.type] ?? ''}`;
        // Без hover:scale — масштабирование сдвигает маркер и «прыгает»;
        // подсвечиваем тенью и рамкой, размер элемента не меняется
        el.className = markerElClassName(o, o.id === selectedIdRef.current);
        el.textContent = String(o.number);
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelect(o.id);
        });
        const marker = new ml.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);
        markersRef.current.set(o.id, marker);
      }
    }

    // (e) раскладываем совпадающие точки (spiderfy, 44px). Пересчёт при движении —
    // на 'moveend' в эффекте кластеров ниже (IMP-23-MAP-04: дешевле, без дрожания);
    // там же точки, попавшие в кластеры на текущем зуме, скрываются (IMP-23-MAP-02)
    spreadMarkers();
    // зависимость — сериализованный список видимых маркеров (БЕЗ selectedId)
  }, [ready, visibleKey, onSelect, spreadMarkers]);

  // Выделение выбранной заявки — ОТДЕЛЬНЫЙ эффект: только переключаем класс
  // DOM-элемента существующих маркеров (getElement), ничего не пересоздаём
  useEffect(() => {
    selectedIdRef.current = selectedId;
    for (const [id, m] of markersRef.current) {
      const o = ordersByIdRef.current.get(id);
      if (o) m.getElement().className = markerElClassName(o, id === selectedId);
    }
  }, [selectedId]);

  // IMP-23-MAP-01: синхронизация колбэка очистки focus-состояния (без пересоздания
  // эффекта перелёта)
  useEffect(() => {
    focusDoneRef.current = onFocusDone;
  }, [onFocusDone]);

  // IMP-23-MAP-02: рендер кластеров. На текущем зуме индекс отдаёт смесь кластеров
  // и отдельных точек: участники кластеров скрываются (display:none — маркеры
  // остаются в DOM и раскрываются при зумировании без пересоздания), поверх
  // рисуются DOM-пилюли с числом заявок (дифф по cluster_id). Вызывается при смене
  // данных и на 'moveend' — во время движения маркеры едут вместе с картой.
  const renderClusters = useCallback(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml || !ready) return;

    // данных нет (пустой набор/фильтр) — снять кластеры, показать все точки
    if (!clusterIndex) {
      for (const m of clusterMarkersRef.current.values()) m.remove();
      clusterMarkersRef.current.clear();
      for (const m of markersRef.current.values()) m.getElement().style.display = '';
      return;
    }

    const zoom = Math.round(map.getZoom());
    const bbox = map.getBounds().toArray().flat() as [number, number, number, number];
    const features = clusterIndex.getClusters(bbox, zoom);

    const nextClusterIds = new Set<string>();
    const individualIds = new Set<string>();

    for (const f of features) {
      // union ClusterFeature | PointFeature — работаем через общую проекцию свойств
      const p = f.properties as ClusterishProps;
      if (p.cluster) {
        const cid = String(p.cluster_id);
        const count = p.point_count ?? 0;
        const [lng, lat] = f.geometry.coordinates as [number, number];
        nextClusterIds.add(cid);
        const existing = clusterMarkersRef.current.get(cid);
        if (existing) {
          existing.setLngLat([lng, lat]);
          const el = existing.getElement();
          if (el.dataset.count !== String(count)) {
            el.dataset.count = String(count);
            el.textContent = String(count);
            el.title = `${count} заявок в кластере — клик раскроет точки`;
            el.setAttribute('aria-label', `Кластер из ${count} заявок`);
          }
        } else {
          const el = document.createElement('button');
          el.type = 'button';
          el.tabIndex = 0;
          el.dataset.count = String(count);
          el.className = CLUSTER_EL_CLASS;
          el.textContent = String(count);
          el.title = `${count} заявок в кластере — клик раскроет точки`;
          el.setAttribute('aria-label', `Кластер из ${count} заявок`);
          const marker = new ml.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
          // клик читает индекс/позицию В МОМЕНТ клика (ref) — переживает смену данных
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const idx = clusterIndexRef.current;
            const m = mapRef.current;
            if (!idx || !m) return;
            const { lng: clng, lat: clat } = marker.getLngLat();
            // раскрытие кластера: зум до точки раскрытия (минимум +1, потолок 18),
            // чтобы отдельные точки стало можно выбрать (spiderfy добьёт остаток)
            const expansion = idx.getClusterExpansionZoom(Number(cid));
            const target = Math.min(Math.max(expansion, m.getZoom() + 1), 18);
            m.easeTo({ center: [clng, clat], zoom: target, duration: 600 });
          });
          clusterMarkersRef.current.set(cid, marker);
        }
      } else if (p.orderId) {
        individualIds.add(p.orderId);
      }
    }

    // снять исчезнувшие кластеры (иначе призраки при смене зума/данных)
    for (const [cid, m] of clusterMarkersRef.current) {
      if (!nextClusterIds.has(cid)) {
        m.remove();
        clusterMarkersRef.current.delete(cid);
      }
    }
    // точки внутри кластеров — скрыть, отдельные — показать
    for (const [id, m] of markersRef.current) {
      m.getElement().style.display = individualIds.has(id) ? '' : 'none';
    }
  }, [ready, clusterIndex]);

  // Актуальный индекс для кликов по пилюлям (IMP-23-MAP-02)
  useEffect(() => {
    clusterIndexRef.current = clusterIndex;
  }, [clusterIndex]);

  // IMP-23-MAP-04: spiderfy-пересчёт перенесён с 'move' на 'moveend' (дешевле,
  // без дрожания); здесь же — перерисовка кластеров после пан/зум/перелётов
  const handleMapMoveEnd = useCallback(() => {
    spreadMarkers();
    renderClusters();
  }, [spreadMarkers, renderClusters]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    renderClusters();
    map.on('moveend', handleMapMoveEnd);
    return () => {
      map.off('moveend', handleMapMoveEnd);
    };
  }, [ready, renderClusters, handleMapMoveEnd]);

  // IMP-23-MAP-03: при смене бота автоподгон выполняется заново (один раз)
  useEffect(() => {
    autoFitDoneRef.current = false;
  }, [botId]);

  // IMP-23-MAP-03: первый автоподгон камеры под видимые точки — один раз и только
  // пока пользователь не взаимодействовал с картой; дальше ручной зум не мешаем
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || autoFitDoneRef.current || userMapInputRef.current) return;
    if (visible.length === 0) return;
    autoFitDoneRef.current = true;
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const o of visible) {
      const lng = o.lng as number;
      const lat = o.lat as number;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 60, maxZoom: 13, duration: 800 }
    );
  }, [ready, visibleKey]);

  // Наведение на заявку из карточки/уведомлений («Показать на карте»):
  // focusTick — чтобы повторный клик по той же заявке тоже срабатывал.
  // IMP-23-MAP-01: зум-храповик убран — зум поднимаем ТОЛЬКО если совсем далеко
  // (<12 → 13), иначе пан без смены зума; после перелёта очищаем stale
  // focus-состояние родителя (once moveend), чтобы оно не жило вечно.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusOrderId) return;
    const o = ordersByIdRef.current.get(focusOrderId);
    if (!o || o.lat == null || o.lng == null) return;
    const z = map.getZoom();
    map.easeTo({ center: [o.lng, o.lat], zoom: z < 12 ? 13 : z, duration: 700 });
    const clearFocus = () => focusDoneRef.current?.();
    map.once('moveend', clearFocus);
    return () => {
      map.off('moveend', clearFocus);
    };
  }, [ready, focusOrderId, focusTick]);

  // Во время режима указания точки список скрываем (баннер занимает то же место)
  useEffect(() => {
    if (placementOrderId) setListOpen(false);
  }, [placementOrderId]);

  // Переход к точке из списка: пан + выделение БЕЗ смены зума (IMP-23-MAP-01:
  // раньше flyTo дожимал зум до 15 и тот никогда не возвращался), без открытия карточки
  const jumpToListPoint = useCallback(
    (o: OrderDto) => {
      const map = mapRef.current;
      if (!map || o.lat == null || o.lng == null) return;
      onHighlight(o.id);
      map.easeTo({ center: [o.lng, o.lat], duration: 500 });
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
      {/* IMP-24-FE1-05: тумблер слоя КП + легенда (компактно, не перекрывает атрибуцию) */}
      <div className="absolute bottom-2.5 left-2.5 z-10 flex max-w-[calc(100%-5rem)] flex-col items-start gap-1.5 sm:bottom-3 sm:left-3">
        {mytkoEnabled && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setKpEnabled((v) => !v)}
              aria-pressed={kpEnabled}
              title="Контейнерные площадки реестра MyTKO в текущей области карты"
              className={cn(
                'flex h-11 shrink-0 items-center gap-1.5 rounded-lg border bg-background/95 px-3 text-xs font-medium shadow-sm backdrop-blur transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:px-2.5',
                kpEnabled &&
                  'border-teal-500/50 bg-teal-500/10 text-teal-700 hover:bg-teal-500/15 dark:text-teal-300'
              )}
            >
              <MapPinned className="h-3.5 w-3.5" aria-hidden />
              {kpEnabled ? 'Скрыть КП' : 'Показать КП'}
            </button>
            {kpEnabled &&
              (kpError ? (
                /* IMP-25-19: ошибка bbox-загрузки КП — не глотаем, даём «Повторить» */
                <div
                  role="alert"
                  className="flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-background/95 px-2 py-1.5 text-xs shadow-sm backdrop-blur"
                >
                  <WifiOff className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                  <span className="shrink-0">Не удалось загрузить КП</span>
                  <button
                    type="button"
                    onClick={() => void loadKpAreas()}
                    aria-label="Повторить загрузку КП"
                    className="min-h-11 rounded px-2 font-semibold text-destructive underline underline-offset-2 transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
                  >
                    Повторить
                  </button>
                </div>
              ) : kpLoading ? (
                <div role="status" aria-label="Загрузка КП">
                  <Skeleton className="h-11 w-[72px] rounded-lg sm:h-8" />
                </div>
              ) : kpGateBlocked ? (
                /* IMP-25-18: zoom-gate — слой не грузится до порога */
                <div
                  role="status"
                  title="КП появляются на карте при масштабе улиц"
                  className="max-w-[210px] rounded-lg border bg-background/95 px-2.5 py-1.5 text-xs leading-snug shadow-sm backdrop-blur"
                >
                  Приблизьте карту
                  {kpTotal > 0 ? (
                    <>
                      {' '}
                      — здесь ~<b className="tabular-nums">{kpTotal}</b> КП
                    </>
                  ) : (
                    ' — здесь КП реестра'
                  )}
                </div>
              ) : (
                <div
                  role="status"
                  aria-label={`КП в текущей области: ${kpTotal}`}
                  title={
                    kpTotal > kpAreas.length
                      ? `Показаны ${kpAreas.length} из ${kpTotal} — ${kpSortOk ? 'ближайшие к центру кадра' : 'первые по коду в кадре'}`
                      : 'КП в текущей области карты'
                  }
                  className="max-w-[230px] rounded-lg border bg-background/95 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur"
                >
                  КП: <b className="tabular-nums">{kpTotal}</b>
                  {/* IMP-25-18: честная подпись, когда точки в кадре обрезаны */}
                  {kpTotal > kpAreas.length && (
                    <span className="block text-[10px] leading-tight text-muted-foreground">
                      показаны {kpAreas.length} —{' '}
                      {kpSortOk ? 'ближайшие к центру кадра' : 'первые по коду в кадре'}
                    </span>
                  )}
                </div>
              ))}
          </div>
        )}
        {/* Легенда */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-lg border bg-background/95 px-2.5 py-1.5 text-[10px] leading-tight shadow-sm backdrop-blur sm:text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> отходы
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> КГМ
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-400" /> выполненные
          </span>
          <span
            className="flex items-center gap-1.5"
            title="Близкие заявки объединяются в кластер — клик по нему раскрывает точки"
          >
            <span
              aria-hidden
              className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-white bg-primary px-1 text-[8px] font-bold leading-none text-primary-foreground shadow-sm"
            >
              N
            </span>
            кластер
          </span>
          <span
            className="flex items-center gap-1.5"
            title="КП реестра MyTKO — включается тумблером «Показать КП»"
          >
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rotate-45 rounded-[2px] border border-white bg-teal-600 shadow-sm"
            />
            КП (реестр)
          </span>
          <span
            className="flex items-center gap-1.5"
            title="Кластер КП — клик по нему раскрывает площадки"
          >
            {/* IMP-25-18: кластеры КП — ромб с числом */}
            <span
              aria-hidden
              className="inline-flex h-3 w-3 rotate-45 items-center justify-center rounded-[3px] border border-white bg-teal-600 shadow-sm"
            >
              <span className="-rotate-45 text-[7px] font-bold leading-none text-white">N</span>
            </span>
            кластер КП
          </span>
        </div>
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

/** Optimistic-пузырь: пока sending — «отправляется…», при ошибке — «Повторить» (текст не теряется) */
type PendingMessage = { tmpId: string; text: string; status: 'sending' | 'error' };

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
  const [pending, setPending] = useState<PendingMessage[]>([]);
  /** FE22-06: получен ли первый ответ сервера — до него показываем скелетон, а не пустое состояние */
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Пользователь у дна переписки? Скролл при новых сообщениях — только тогда */
  const isNearBottomRef = useRef(true);
  /** Ключ активной заявки — защита от гонки: ответ старого запроса не должен
   *  попасть в чат новой заявки при быстром переключении карточек */
  const activeKeyRef = useRef('');

  // Поллинг с дедуп-слиянием по id (IMP-F11): первая загрузка — полная история,
  // далее ?take=50. Слияние защитает и бэкенд без поддержки ?take, и гонки ответов.
  const fetchMessages = useCallback(
    async (take: number | null) => {
      const key = `${botId}/${orderId}`;
      try {
        const d = await api<{ messages: OrderMessageDto[] }>(
          `/api/bots/${botId}/orders/${orderId}/messages${take ? `?take=${take}` : ''}`
        );
        if (activeKeyRef.current !== key) return; // ответ устарел — заявка уже другая
        setMessages((prev) => mergeMessages(prev, d.messages));
      } catch {
        /* polling errors ignored */
      } finally {
        setInitialLoaded(true);
      }
    },
    [botId, orderId]
  );

  useEffect(() => {
    activeKeyRef.current = `${botId}/${orderId}`;
    setMessages([]);
    setPending([]);
    setInitialLoaded(false);
    isNearBottomRef.current = true;
    fetchMessages(null); // полная первая загрузка
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => fetchMessages(50), 3000);
    // пауза поллинга на скрытой вкладке + немедленный тик при возврате
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      } else if (!timer) {
        fetchMessages(50);
        timer = setInterval(() => fetchMessages(50), 3000);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [botId, orderId, fetchMessages]);

  // Умный автоскролл (IMP-F11): тянем к дну только если пользователь и так у дна (< 120px)
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el || !isNearBottomRef.current) return;
      el.scrollTo({ top: el.scrollHeight });
    });
  }, [messages.length, pending]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const sendMessage = useCallback(
    async (body: string, tmpId: string) => {
      try {
        const d = await api<{ message: OrderMessageDto; delivered: boolean; deliveryError?: string }>(
          `/api/bots/${botId}/orders/${orderId}/messages`,
          { method: 'POST', body: JSON.stringify({ text: body }) }
        );
        setMessages((prev) => mergeMessages(prev, [d.message]));
        setPending((p) => p.filter((x) => x.tmpId !== tmpId));
        if (!d.delivered && d.deliveryError) {
          toast({ title: 'Не доставлено в мессенджер', description: d.deliveryError, variant: 'destructive' });
        }
      } catch {
        // текст не теряем: пузырь становится ошибочным, доступна кнопка «Повторить»
        setPending((p) => p.map((x) => (x.tmpId === tmpId ? { ...x, status: 'error' } : x)));
        toast({ title: 'Не удалось отправить', variant: 'destructive' });
      } finally {
        setSending(false);
      }
    },
    [botId, orderId, toast]
  );

  const send = () => {
    const t = text.trim();
    if (!t) return;
    const tmpId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setSending(true);
    setText('');
    setPending((p) => [...p, { tmpId, text: t, status: 'sending' }]);
    void sendMessage(t, tmpId);
  };

  const retry = (m: PendingMessage) => {
    setPending((p) => p.map((x) => (x.tmpId === m.tmpId ? { ...x, status: 'sending' } : x)));
    setSending(true);
    void sendMessage(m.text, m.tmpId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" />
        Чат с клиентом по заявке — сообщения доставляются в его мессенджер
      </div>
      {/* Чат с клиентом по заявке */}
      <div
        ref={scrollRef}
        aria-live="polite"
        onScroll={handleScroll}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 p-3"
      >
        {/* FE22-06: до первого ответа fetchMessages — скелетон (3 пузыря-заглушки),
            пустое состояние — только после реального пустого ответа сервера */}
        {!initialLoaded && messages.length === 0 && pending.length === 0 && (
          <div
            className="flex h-full flex-col justify-center gap-2.5 px-4"
            role="status"
            aria-label="Загружаем сообщения"
          >
            <span className="sr-only">Загружаем сообщения…</span>
            <div className="h-12 w-3/4 animate-pulse rounded-xl rounded-bl-md bg-muted" />
            <div className="ml-auto h-9 w-2/3 animate-pulse rounded-xl rounded-br-md bg-muted" />
            <div className="h-14 w-4/5 animate-pulse rounded-xl rounded-bl-md bg-muted" />
          </div>
        )}
        {initialLoaded && messages.length === 0 && pending.length === 0 && (
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
        {/* Optimistic-пузыри (IMP-F11): полупрозрачный с часами — отправляется;
            при ошибке — error-пузырь с кнопкой «Повторить», введённый текст сохранён */}
        {pending.map((p) => (
          <div key={p.tmpId} className="flex justify-end">
            <div
              className={cn(
                'max-w-[85%] space-y-0.5 rounded-2xl rounded-br-md px-3 py-1.5 text-sm leading-snug',
                p.status === 'error'
                  ? 'border border-destructive/40 bg-destructive/10 text-destructive'
                  : 'bg-primary text-primary-foreground opacity-70'
              )}
            >
              <div className="whitespace-pre-wrap">{p.text}</div>
              <div className="flex items-center justify-end gap-1 text-[10px] opacity-80">
                {p.status === 'sending' ? (
                  <>
                    <Clock className="h-3 w-3" aria-hidden /> отправляется…
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => retry(p)}
                    aria-label="Повторить отправку сообщения"
                    className="rounded font-semibold underline underline-offset-2 transition-colors hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Повторить
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
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

// ─── Кнопка копирования (IMP-F13) ──────────────────────────────────────────

function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
      toast({ title: `Скопировано: ${label}` });
    } catch {
      toast({ title: 'Не удалось скопировать', variant: 'destructive' });
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Копировать: ${label}`}
      title={`Копировать: ${label}`}
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
    >
      <Copy
        className={cn('h-3.5 w-3.5', copied && 'text-emerald-600 dark:text-emerald-400')}
        aria-hidden
      />
    </button>
  );
}

// ─── Скелетон карточки заявки (IMP-F16) ─────────────────────────────────────

function OrderDetailSkeleton() {
  return (
    <div
      className="min-h-0 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))] md:grid md:grid-cols-2 md:overflow-hidden md:pb-0"
      role="status"
      aria-label="Загрузка заявки"
    >
      <span className="sr-only">Загрузка заявки…</span>
      {/* Левая колонка: клиент + данные заявки (сетка как у реальной карточки) */}
      <div className="min-h-0 space-y-4 border-b p-4 md:border-b-0 md:border-r md:overflow-hidden">
        <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/5" />
        </div>
        <div className="space-y-3 rounded-xl border p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
      {/* Правая колонка: блок чата */}
      <div className="flex h-[46dvh] min-h-[300px] flex-col gap-2 p-4 md:h-auto md:min-h-0 md:overflow-hidden">
        <Skeleton className="h-8 w-full shrink-0" />
        <Skeleton className="h-16 w-3/4" />
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-10 w-full shrink-0" />
      </div>
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
  crews,
  onOpenCrews,
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
  /** IMP-24-FE1-02: справочник экипажей (состояние живёт в OrdersView) */
  crews: CrewDto[];
  /** IMP-24-FE1-02: открыть диалог управления экипажами */
  onOpenCrews: () => void;
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
  /** FE22-07: busy у кнопки-действия AlertDialog — двойной клик невозможен */
  const [deleting, setDeleting] = useState(false);
  const [mytkoBusy, setMytkoBusy] = useState(false);
  // IMP-24-FE1-01: имя и телефон клиента — редактируемые (сохранение по blur)
  const [clientName, setClientName] = useState('');
  const [phone, setPhone] = useState('');
  // IMP-24-FE1-04: кандидаты на совмещение с КП реестра + «Не сейчас» на сессию
  const [areaCandidates, setAreaCandidates] = useState<AreaMatchCandidate[]>([]);
  const [areaDismissedId, setAreaDismissedId] = useState<string | null>(null);
  const areaKeyRef = useRef('');
  const areaAbortRef = useRef<AbortController | null>(null);

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
      setClientName(d.order.clientName ?? ''); // IMP-24-FE1-01
      setPhone(d.order.phone ?? ''); // IMP-24-FE1-01
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
      setDeleting(false);
      setConfirmGeo(false);
      setClientName('');
      setPhone('');
      setAreaCandidates([]); // IMP-24-FE1-04: отмена/сброс саджеста при закрытии
      setAreaDismissedId(null);
      areaKeyRef.current = '';
      areaAbortRef.current?.abort();
    }
  }, [open, orderId, load]);

  // IMP-24-FE1-04: кандидаты на совмещение с КП реестра — запрашиваются при открытии
  // карточки и после каждого изменения заявки (runGeocode/указание точки/патчи);
  // кэш по order.id+updatedAt, отмена при закрытии/переключении.
  useEffect(() => {
    if (!open || !order) return;
    if (order.areaLkCode) {
      setAreaCandidates([]); // уже совмещена — подсказка не нужна
      return;
    }
    const key = `${order.id}:${order.updatedAt}`;
    if (areaKeyRef.current === key) return;
    areaKeyRef.current = key;
    areaAbortRef.current?.abort();
    const ac = new AbortController();
    areaAbortRef.current = ac;
    api<{ candidates: AreaMatchCandidate[] }>(
      `/api/bots/${botId}/orders/${order.id}/area-match`,
      { signal: ac.signal }
    )
      .then((d) => {
        if (!ac.signal.aborted) setAreaCandidates(d.candidates ?? []);
      })
      .catch(() => {
        if (!ac.signal.aborted) setAreaCandidates([]);
      });
    return () => ac.abort();
  }, [open, order, botId]);

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
    } catch (e) {
      // IMP-25-22: причина ошибки (валидация бэка/сеть) видна оператору
      toast({
        title: 'Ошибка сохранения',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
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
    if (!orderId || deleting) return;
    setDeleting(true);
    try {
      await api(`/api/bots/${botId}/orders/${orderId}`, { method: 'DELETE' });
      toast({ title: `Заявка удалена` });
      setConfirmDelete(false);
      onDataChanged();
      onClose();
    } catch {
      toast({ title: 'Не удалось удалить', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  /** FE22-04: вся заявка текстом — построчно «Метка: значение», пустые поля пропускаются */
  const copyOrderText = async () => {
    if (!order) return;
    const lines = (
      [
        ['Номер', `№${order.number}`],
        ['Тип', ORDER_TYPE_LABELS[order.type] ?? order.type],
        ['Статус', ORDER_STATUS_LABELS[order.status] ?? order.status],
        ['Клиент', order.clientName || order.conversation?.contact || ''],
        ['Телефон', order.phone ?? ''],
        ['Город', order.city ?? ''],
        ['Адрес', order.address ?? ''],
        ['Размер', order.size ?? ''],
        ['Дата подачи', order.wishDate ?? ''],
        ['Комментарий', order.comment ?? ''],
        [
          'Координаты',
          order.lat != null ? `${order.lat.toFixed(5)}, ${(order.lng ?? 0).toFixed(5)}` : '',
        ],
      ] as const
    )
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}: ${v}`);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast({ title: 'Заявка скопирована' });
    } catch {
      toast({ title: 'Не удалось скопировать', variant: 'destructive' });
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

  // IMP-25-22: желаемая дата не распознана парсером — превью-подсказка оператору
  const wishUnmatched = wishDate.trim() !== '' && !parseWishDate(wishDate.trim()).matched;

  // IMP-24-FE1-02: активные экипажи первыми, затем неактивные (алфавит внутри групп)
  const { activeCrews, inactiveCrews } = useMemo(() => {
    const byName = (a: CrewDto, b: CrewDto) => a.name.localeCompare(b.name, 'ru');
    return {
      activeCrews: crews.filter((c) => c.active).sort(byName),
      inactiveCrews: crews.filter((c) => !c.active).sort(byName),
    };
  }, [crews]);

  /** FE22-01: чипы следующего шага по схеме статусов. Реальные статусы — из
   *  ORDER_STATUS_LABELS (new/assigned/in_progress/completed/cancelled):
   *  new/assigned → in_progress «Взять в работу», in_progress → completed «Выполнить».
   *  Финальные статусы чипов не имеют (и без force PATCH вернёт 400) — остаётся Select. */
  const quickStatusActions: { to: string; label: string; icon: typeof Check; cls: string }[] = [];
  if (order && !ARCHIVE_STATUSES.includes(order.status)) {
    if (order.status === 'in_progress') {
      quickStatusActions.push({
        to: 'completed',
        label: 'Выполнить',
        icon: Check,
        cls: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20',
      });
    } else {
      quickStatusActions.push({
        to: 'in_progress',
        label: 'Взять в работу',
        icon: Play,
        cls: 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15',
      });
    }
  }

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
            {order && <CopyButton value={String(order.number)} label="номер заявки" className="-ml-1" />}
            {order && (
              <button
                type="button"
                onClick={copyOrderText}
                aria-label="Скопировать заявку"
                title="Скопировать заявку"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
            {/* FE22-05: переход в диалог клиента (listener bstudio:open-conversation — в app-root, Task 22-FE2) */}
            {order?.conversation && order.conversationId && (
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('bstudio:open-conversation', {
                      detail: { conversationId: order.conversationId },
                    })
                  )
                }
                aria-label="Открыть диалог клиента"
                title="Открыть диалог клиента"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MessageCircle className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Карточка заявки: данные клиента, статус и встроенный чат
          </DialogDescription>
        </DialogHeader>

        {!order && loading ? (
          <OrderDetailSkeleton />
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
                <div className="mt-2 space-y-2 text-sm">
                  {/* IMP-24-FE1-01: имя и телефон редактируемые — сохранение по blur,
                      пустое значение → null. Тел-ссылка и копирование — рядом. */}
                  <Input
                    aria-label="Имя клиента"
                    value={clientName}
                    placeholder={order.conversation?.contact || 'Имя клиента'}
                    onChange={(e) => setClientName(e.target.value)}
                    onBlur={() => {
                      const v = clientName.trim();
                      if (v !== (order.clientName ?? ''))
                        patch({ clientName: v || null }, 'Имя клиента сохранено');
                    }}
                    disabled={saving}
                  />
                  <div className="flex items-center gap-1.5">
                    <Input
                      className="min-w-0 flex-1"
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                      aria-label="Телефон клиента"
                      value={phone}
                      placeholder="+7 900 …"
                      onChange={(e) => setPhone(e.target.value)}
                      onBlur={() => {
                        const v = phone.trim();
                        if (v !== (order.phone ?? '')) patch({ phone: v || null }, 'Телефон сохранён');
                      }}
                      disabled={saving}
                    />
                    {order.phone && (
                      <a
                        href={`tel:${order.phone.replace(/[^\d+]/g, '')}`}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Позвонить клиенту ${order.phone}`}
                        title="Позвонить клиенту"
                      >
                        <Phone className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    )}
                    {order.phone && <CopyButton value={order.phone} label="телефон клиента" />}
                  </div>
                  {order.conversation?.externalUserId && (
                    <div className="flex items-center gap-1 break-all text-xs text-muted-foreground">
                      <span>ID клиента: {order.conversation.externalUserId}</span>
                      <CopyButton value={order.conversation.externalUserId} label="ID клиента" />
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
                      disabled={saving}
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
                    {/* FE22-01: быстрые действия статуса (отмены/откаты — через Select) */}
                    {quickStatusActions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {quickStatusActions.map((a) => (
                          <button
                            key={a.to}
                            type="button"
                            disabled={saving}
                            onClick={() => patch({ status: a.to }, 'Статус обновлён')}
                            aria-label={`Статус: ${a.label}`}
                            className={cn(
                              'inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                              a.cls
                            )}
                          >
                            <a.icon className="h-3.5 w-3.5" aria-hidden />
                            {a.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* FE22-02: мини-таймлайн — Создана → Обновлена → Выполнена */}
                    {(() => {
                      const created = new Date(order.createdAt).getTime();
                      const updated = new Date(order.updatedAt).getTime();
                      const points: { label: string; iso: string; done?: boolean }[] = [
                        { label: 'Создана', iso: order.createdAt },
                      ];
                      if (Math.abs(updated - created) > 60_000)
                        points.push({ label: 'Обновлена', iso: order.updatedAt });
                      if (order.completedAt)
                        points.push({ label: 'Выполнена', iso: order.completedAt, done: true });
                      return (
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pt-0.5 text-[11px] text-muted-foreground">
                          {points.map((p, i) => (
                            <span key={p.label} className="flex items-center gap-1.5">
                              {i > 0 && <span className="h-px w-2.5 bg-border" aria-hidden />}
                              <span
                                className={cn(
                                  'h-1.5 w-1.5 rounded-full',
                                  p.done ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                                )}
                                aria-hidden
                              />
                              <span className="tabular-nums" title={fmtDate(p.iso)}>
                                {p.label} {fmtRel(p.iso)}
                              </span>
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-muted-foreground">Желаемая дата</Label>
                    <Input
                      className="h-9"
                      value={wishDate}
                      placeholder="напр. завтра до 12:00 или 23.10"
                      onChange={(e) => setWishDate(e.target.value)}
                      onBlur={() => {
                        if (wishDate !== (order.wishDate ?? '')) {
                          patch({ wishDate }, 'Дата обновлена');
                        }
                      }}
                      disabled={saving}
                    />
                    {/* IMP-25-22: превью распознавания свободного текста даты */}
                    {wishUnmatched && (
                      <div role="note" className="text-[11px] text-amber-600 dark:text-amber-400">
                        Дата не распознана — уточните или выберите вручную
                      </div>
                    )}
                    {/* IMP-25-22: точная дата забора — календарный инпут пишет pickupAt (YYYY-MM-DD) */}
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <Label
                        htmlFor={`order-pickup-${order.id}`}
                        className="shrink-0 text-[11px] font-medium text-muted-foreground"
                      >
                        Когда забрать
                      </Label>
                      <Input
                        type="date"
                        id={`order-pickup-${order.id}`}
                        className="h-9 w-[150px]"
                        value={pickupInputValue(order.pickupAt)}
                        onChange={(e) =>
                          patch(
                            { pickupAt: e.target.value || null },
                            e.target.value ? 'Дата забора обновлена' : 'Дата забора очищена'
                          )
                        }
                        disabled={saving}
                        aria-label="Дата забора машины (точная дата)"
                      />
                    </div>
                    {/* IMP-24-FE1-03: разобранная дата подачи машины (из wishDate) */}
                    {order.pickupAt && (
                      <div
                        className="flex w-fit items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300"
                        title="Дата подачи машины, разобранная из желаемой даты"
                      >
                        <CalendarDays className="h-3 w-3 shrink-0" aria-hidden />
                        Забор: <span className="font-medium">{formatDateRu(order.pickupAt)}</span>
                      </div>
                    )}
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
                      disabled={saving}
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
                {/* IMP-24-FE1-02: экипаж из справочника + кнопка справочника */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs font-medium text-muted-foreground">Экипаж</Label>
                    <button
                      type="button"
                      onClick={onOpenCrews}
                      aria-label="Открыть справочник экипажей"
                      title="Справочник экипажей"
                      className="flex min-h-11 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:py-1"
                    >
                      <Users className="h-3.5 w-3.5" aria-hidden /> Экипажи…
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={order.crewId ?? 'none'}
                      onValueChange={(v) => patch({ crewId: v === 'none' ? null : v }, 'Экипаж обновлён')}
                      disabled={saving}
                    >
                      <SelectTrigger className="h-9 min-w-0 flex-1">
                        <SelectValue placeholder="Не назначен" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Без экипажа</SelectItem>
                        {activeCrews.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                        {inactiveCrews.map((c) => (
                          <SelectItem
                            key={c.id}
                            value={c.id}
                            disabled={c.id !== order.crewId}
                            className="opacity-60"
                          >
                            {c.name} (неактивен)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {order.crew?.phone && (
                      <a
                        href={`tel:${order.crew.phone.replace(/[^\d+]/g, '')}`}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Позвонить экипажу «${order.crew.name}»`}
                        title={`Экипаж «${order.crew.name}» — ${order.crew.phone}`}
                      >
                        <Phone className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    )}
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
                      disabled={saving}
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
                    <div className="flex items-center gap-1 pt-1 text-[11px] tabular-nums text-muted-foreground">
                      <span>
                        Координаты: {order.lat.toFixed(5)}, {order.lng?.toFixed(5)}
                        {order.geoSource === 'manual' && ' · указано вручную'}
                        {order.geoSource === 'geocode' && ' · по адресу'}
                      </span>
                      <CopyButton
                        value={`${order.lat.toFixed(5)}, ${order.lng?.toFixed(5)}`}
                        label="координаты"
                      />
                    </div>
                  ) : (
                    <div className="pt-1 text-[11px] text-amber-600 dark:text-amber-400">
                      Точка на карте не указана
                    </div>
                  )}
                  {/* IMP-24-FE1-04: совмещение с КП реестра MyTKO */}
                  {order.areaLkCode ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-300/70 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                      <MapPinned className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span
                        className="min-w-0 flex-1 break-words font-medium"
                        title="Заявка совмещена с КП реестра MyTKO"
                      >
                        КП {order.areaLkCode}
                        {order.areaAddress ? ` — ${order.areaAddress}` : ''}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-11 shrink-0 border-emerald-300/70 hover:bg-emerald-100 sm:h-7 dark:border-emerald-500/30 dark:hover:bg-emerald-500/20"
                        disabled={saving}
                        onClick={() => patch({ areaLkCode: null }, 'Заявка отвязана от КП')}
                      >
                        Отвязать
                      </Button>
                    </div>
                  ) : (
                    areaDismissedId !== order.id &&
                    areaCandidates.length > 0 && (
                      <div className="rounded-lg border border-amber-300/70 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                        <div className="font-medium">Похоже, это КП из реестра:</div>
                        <ul className="mt-1.5 space-y-1.5">
                          {areaCandidates.slice(0, 3).map((c) => (
                            <li key={c.lkCode} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span
                                className="min-w-0 flex-1 break-words"
                                title={
                                  c.byCoord
                                    ? `совпадение по координатам (${Math.round(c.distanceM ?? 0)} м)`
                                    : c.byAddress
                                      ? 'совпадение по адресу'
                                      : undefined
                                }
                              >
                                <b>{c.lkCode}</b> — {c.address ?? 'без адреса'} ·{' '}
                                {c.distanceM != null ? fmtDistanceM(c.distanceM) : '— м'}
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-11 shrink-0 border-amber-300/70 hover:bg-amber-100 sm:h-7 dark:border-amber-500/30 dark:hover:bg-amber-500/20"
                                disabled={saving}
                                onClick={() => patch({ areaLkCode: c.lkCode }, 'Заявка совмещена с КП')}
                              >
                                Совместить
                              </Button>
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          onClick={() => setAreaDismissedId(order.id)}
                          className="mt-1.5 min-h-11 rounded px-1 font-medium underline underline-offset-2 transition-colors hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
                        >
                          Не сейчас
                        </button>
                      </div>
                    )
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
                    disabled={saving}
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
                  <button
                    className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setConfirmDelete(true)}
                    aria-label="Удалить заявку"
                  >
                    <Trash2 className="h-3 w-3" /> удалить
                  </button>
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
      {/* FE22-07: подтверждение удаления через AlertDialog (паттерн волны 21, dashboard deleteBot) */}
      <AlertDialog
        open={confirmDelete}
        onOpenChange={(o) => {
          if (!o && !deleting) setConfirmDelete(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить заявку?</AlertDialogTitle>
            <AlertDialogDescription>
              Заявка №{order?.number ?? '—'} будет удалена безвозвратно. Это действие нельзя
              отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault(); // диалог не закрываем — ждём ответ сервера (busy виден)
                remove();
              }}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Удалить безвозвратно
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

// ─── Справочник экипажей (IMP-24-FE1-02) ───────────────────────────────────

/** Строка справочника: инлайн-редактирование имени/телефона (сохранение по blur,
 *  пустой телефон → null), Switch активности, кнопка удаления (подтверждение — у родителя) */
function CrewRow({
  botId,
  crew,
  onUpdate,
  onRemoveRequest,
}: {
  botId: string;
  crew: CrewDto;
  onUpdate: (crew: CrewDto) => void;
  onRemoveRequest: (crew: CrewDto) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(crew.name);
  const [phone, setPhone] = useState(crew.phone ?? '');
  const [busy, setBusy] = useState(false);

  // внешнее обновление (ответ PATCH, переключение active) — синхронизируем поля
  useEffect(() => {
    setName(crew.name);
    setPhone(crew.phone ?? '');
  }, [crew.id, crew.name, crew.phone]);

  const patchCrew = useCallback(
    async (data: Record<string, unknown>) => {
      setBusy(true);
      try {
        const d = await api<{ crew: CrewDto }>(`/api/bots/${botId}/crews/${crew.id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        });
        onUpdate(d.crew);
        return true;
      } catch {
        toast({ title: 'Не удалось сохранить экипаж', variant: 'destructive' });
        setName(crew.name); // откат локальных правок к сохранённым
        setPhone(crew.phone ?? '');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [botId, crew.id, crew.name, crew.phone, onUpdate, toast]
  );

  const saveName = () => {
    const v = name.trim();
    if (!v) {
      setName(crew.name); // пустое имя запрещено — возвращаем прежнее
      return;
    }
    if (v !== crew.name) void patchCrew({ name: v });
  };

  const savePhone = () => {
    const v = phone.trim();
    if (v !== (crew.phone ?? '')) void patchCrew({ phone: v || null });
  };

  return (
    <li className="rounded-xl border bg-card p-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Input
            className="h-9"
            value={name}
            placeholder="Название экипажа"
            aria-label={`Название экипажа «${crew.name}»`}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
          />
          <Input
            className="h-9"
            type="tel"
            inputMode="tel"
            value={phone}
            placeholder="Телефон (необязательно)"
            aria-label={`Телефон экипажа «${crew.name}»`}
            disabled={busy}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={savePhone}
          />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {typeof crew.ordersCount === 'number' && (
              <span>
                заявок: <b className="tabular-nums">{crew.ordersCount}</b>
              </span>
            )}
            {!crew.active && (
              <span className="font-medium text-amber-600 dark:text-amber-400">неактивен</span>
            )}
          </div>
        </div>
        <label className="flex min-h-11 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 px-1 sm:min-h-0">
          <Switch
            checked={crew.active}
            disabled={busy}
            onCheckedChange={(v) => void patchCrew({ active: v })}
            aria-label={`Экипаж «${crew.name}» ${crew.active ? 'активен' : 'неактивен'}`}
          />
          <span className="text-[10px] leading-none text-muted-foreground">активен</span>
        </label>
        <button
          type="button"
          onClick={() => onRemoveRequest(crew)}
          disabled={busy}
          aria-label={`Удалить экипаж «${crew.name}»`}
          title="Удалить экипаж"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:w-9"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </li>
  );
}

/** Диалог управления справочником экипажей: список + создание + удаление.
 *  crews/setCrews живут в OrdersView — изменения видны карточке заявки сразу. */
function CrewsManagerDialog({
  botId,
  open,
  onClose,
  crews,
  setCrews,
}: {
  botId: string;
  open: boolean;
  onClose: () => void;
  crews: CrewDto[];
  setCrews: Dispatch<SetStateAction<CrewDto[]>>;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  /** экипаж, ожидающий подтверждения удаления */
  const [deletingCrew, setDeletingCrew] = useState<CrewDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  // при закрытии — чистим локальные состояния
  useEffect(() => {
    if (!open) {
      setName('');
      setPhone('');
      setDeletingCrew(null);
      setDeleting(false);
    }
  }, [open]);

  // активные первыми, внутри групп — по алфавиту
  const sorted = useMemo(
    () =>
      [...crews].sort((a, b) =>
        a.active === b.active ? a.name.localeCompare(b.name, 'ru') : a.active ? -1 : 1
      ),
    [crews]
  );

  const updateCrew = useCallback(
    (c: CrewDto) => setCrews((prev) => prev.map((x) => (x.id === c.id ? c : x))),
    [setCrews]
  );

  const create = async () => {
    const n = name.trim();
    if (!n || creating) return;
    setCreating(true);
    try {
      const d = await api<{ crew: CrewDto }>(`/api/bots/${botId}/crews`, {
        method: 'POST',
        body: JSON.stringify({ name: n, phone: phone.trim() || undefined }),
      });
      setCrews((prev) => [...prev, d.crew]);
      setName('');
      setPhone('');
      toast({ title: `Экипаж «${d.crew.name}» добавлен` });
    } catch {
      toast({ title: 'Не удалось создать экипаж', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const remove = async () => {
    if (!deletingCrew || deleting) return;
    const target = deletingCrew;
    setDeleting(true);
    try {
      await api(`/api/bots/${botId}/crews/${target.id}`, { method: 'DELETE' });
      setCrews((prev) => prev.filter((x) => x.id !== target.id));
      toast({ title: `Экипаж «${target.name}» удалён` });
      setDeletingCrew(null);
    } catch {
      toast({ title: 'Не удалось удалить экипаж', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" aria-hidden /> Экипажи
          </DialogTitle>
          <DialogDescription>
            Справочник бригад: активные доступны в карточке заявки, телефон — для быстрого звонка.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-2 rounded-xl border bg-muted/30 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={name}
              placeholder="Название (напр. Бригада 1)"
              aria-label="Название нового экипажа"
              disabled={creating}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              value={phone}
              type="tel"
              inputMode="tel"
              placeholder="Телефон (необязательно)"
              aria-label="Телефон нового экипажа"
              disabled={creating}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            className="h-11 w-full sm:h-9 sm:w-auto"
            disabled={creating || !name.trim()}
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            Добавить экипаж
          </Button>
        </form>
        {sorted.length === 0 ? (
          <div className="rounded-xl border border-dashed py-6 text-center text-xs text-muted-foreground">
            Экипажей пока нет — добавьте первого.
          </div>
        ) : (
          <ul className="space-y-2">
            {sorted.map((c) => (
              <CrewRow
                key={c.id}
                botId={botId}
                crew={c}
                onUpdate={updateCrew}
                onRemoveRequest={setDeletingCrew}
              />
            ))}
          </ul>
        )}
      </DialogContent>
      {/* Подтверждение удаления экипажа (паттерн AlertDialog карточки заявки) */}
      <AlertDialog
        open={!!deletingCrew}
        onOpenChange={(o) => {
          if (!o && !deleting) setDeletingCrew(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить экипаж?</AlertDialogTitle>
            <AlertDialogDescription>
              Экипаж «{deletingCrew?.name ?? ''}» будет удалён из справочника. Заявки, где он
              назначен, останутся без экипажа.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault(); // диалог не закрываем — ждём ответ сервера
                void remove();
              }}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

// ─── Карточка КП реестра (IMP-24-FE1-05) ─────────────────────────────────────

/** Клик по КП-маркеру на карте: адрес, координаты, OSM, расстояние до выбранной
 *  заявки (локальный haversine), перелёт к площадке и совмещение с заявкой.
 *  IMP-25-19: состояние «Совмещена с этой заявкой» + «Отвязать»; замена существующей
 *  привязки другой КП — через AlertDialog; «Перелететь к КП» — CustomEvent для карты. */
function KpDialog({
  area,
  selectedOrder,
  onClose,
  onAttach,
  onDetach,
}: {
  area: AreaItem | null;
  /** заявка, выбранная на карте/в списке — кандидат на совмещение */
  selectedOrder: OrderDto | null;
  onClose: () => void;
  onAttach: (area: AreaItem, orderId: string) => Promise<void>;
  /** IMP-25-19: отвязать выбранную заявку от её текущей КП */
  onDetach: (order: OrderDto) => Promise<void>;
}) {
  const [attaching, setAttaching] = useState(false);
  const [detaching, setDetaching] = useState(false);
  /** IMP-25-19: подтверждение замены уже привязанной КП другой */
  const [confirmReplace, setConfirmReplace] = useState(false);

  /** IMP-25-19: эта КП уже совмещена с выбранной заявкой */
  const attached = !!(area && selectedOrder && selectedOrder.areaLkCode === area.lkCode);
  /** IMP-25-19: у выбранной заявки есть ДРУГАЯ привязка — замена через confirm */
  const hasOtherLink = !!(
    area &&
    selectedOrder?.areaLkCode &&
    selectedOrder.areaLkCode !== area.lkCode
  );

  const handleAttach = async () => {
    if (!area || !selectedOrder || attaching) return;
    setAttaching(true);
    try {
      await onAttach(area, selectedOrder.id);
    } finally {
      setAttaching(false);
    }
  };

  const handleDetach = async () => {
    if (!selectedOrder || detaching) return;
    setDetaching(true);
    try {
      await onDetach(selectedOrder);
    } finally {
      setDetaching(false);
    }
  };

  /** IMP-25-19: перелететь к КП (зум 16) — карта слушает CustomEvent bstudio:kp-ease */
  const flyToArea = () => {
    if (!area || area.lat == null || area.lng == null) return;
    window.dispatchEvent(
      new CustomEvent('bstudio:kp-ease', { detail: { lng: area.lng, lat: area.lat, zoom: 16 } })
    );
  };

  // расстояние до выбранной заявки — локальный haversine (если есть обе точки)
  const dist =
    area &&
    selectedOrder &&
    selectedOrder.lat != null &&
    selectedOrder.lng != null &&
    area.lat != null &&
    area.lng != null
      ? haversineM(selectedOrder.lat, selectedOrder.lng, area.lat, area.lng)
      : null;

  return (
    <Dialog open={!!area} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPinned className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden />
            КП {area?.lkCode ?? ''}
          </DialogTitle>
          <DialogDescription>Контейнерная площадка из реестра MyTKO</DialogDescription>
        </DialogHeader>
        {area && (
          <div className="space-y-3 text-sm">
            <div className="break-words">{area.address ?? 'Адрес в реестре не указан'}</div>
            {area.lat != null && area.lng != null && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {area.lat.toFixed(5)}, {area.lng.toFixed(5)}
                </span>
                <a
                  href={osmUrl(area.lat, area.lng)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center gap-1 rounded-md text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
                  aria-label={`КП ${area.lkCode} на карте OpenStreetMap`}
                >
                  <Globe className="h-3.5 w-3.5" aria-hidden /> OpenStreetMap
                </a>
              </div>
            )}
            {dist != null && selectedOrder && (
              <div className="rounded-lg border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
                До заявки №{selectedOrder.number}:{' '}
                <b className="tabular-nums text-foreground">≈ {fmtDistanceM(dist)}</b>
              </div>
            )}
            {/* IMP-25-19: перелёт камеры к площадке (зум 16) */}
            {area.lat != null && area.lng != null && (
              <Button variant="outline" className="h-11 w-full sm:h-9" onClick={flyToArea}>
                <Crosshair className="h-4 w-4" aria-hidden /> Перелететь к КП
              </Button>
            )}
            {selectedOrder ? (
              attached ? (
                /* IMP-25-19: КП уже совмещена с этой заявкой — статус + «Отвязать»
                   вместо повторного «Совместить» */
                <div className="space-y-2">
                  <div
                    role="status"
                    className="flex items-center gap-1.5 rounded-lg border border-emerald-300/70 bg-emerald-50 px-2.5 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                  >
                    <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Совмещена с этой заявкой (№{selectedOrder.number})
                  </div>
                  <Button
                    variant="outline"
                    className="h-11 w-full sm:h-9"
                    disabled={detaching}
                    onClick={() => void handleDetach()}
                  >
                    {detaching ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <MapPinned className="h-4 w-4" aria-hidden />
                    )}
                    Отвязать от заявки
                  </Button>
                </div>
              ) : (
                <Button
                  className="h-11 w-full sm:h-9"
                  disabled={attaching}
                  onClick={() => {
                    // IMP-25-19: замена существующей привязки другой КП — через confirm
                    if (hasOtherLink) setConfirmReplace(true);
                    else void handleAttach();
                  }}
                >
                  {attaching ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Check className="h-4 w-4" aria-hidden />
                  )}
                  Совместить с заявкой №{selectedOrder.number}
                </Button>
              )
            ) : (
              <div
                role="status"
                className="rounded-lg border border-amber-300/70 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
              >
                Выберите заявку, чтобы совместить с этой КП
              </div>
            )}
          </div>
        )}
      </DialogContent>
      {/* IMP-25-19: у заявки уже есть привязка другой КП — замена требует подтверждения */}
      <AlertDialog
        open={confirmReplace}
        onOpenChange={(o) => {
          if (!o && !attaching) setConfirmReplace(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Заменить привязку КП?</AlertDialogTitle>
            <AlertDialogDescription>
              У заявки №{selectedOrder?.number ?? '—'} уже привязана КП{' '}
              {selectedOrder?.areaLkCode ?? '—'}. Вместо неё будет привязана КП {area?.lkCode ?? '—'}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={attaching}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setConfirmReplace(false);
                void handleAttach();
              }}
            >
              {attaching && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Заменить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  /** FE22-10: POST возвращает созданную заявку — её id сразу открываем в карточке */
  onCreated: (orderId: string) => void;
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
      const d = await api<{ order: OrderDto }>(`/api/bots/${botId}/orders`, {
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
      onCreated(d.order.id);
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
                placeholder="напр. завтра до 12:00 или 23.10" // IMP-24-FE1-06
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

/** memo-строка списка (IMP-F12): сравниваем только поля, реально влияющие на отрисовку,
 *  чтобы поллинг (новые объекты заявок каждые 6 с) не перерисовывал весь список.
 *  onOpen — стабильный useCallback, mytkoEnabled — примитив. */
const OrderRow = memo(
  function OrderRow({
    order,
    onOpen,
    mytkoEnabled,
    selected = false, // IMP-25-20
    onToggleSelect, // IMP-25-20
  }: {
    order: OrderDto;
    onOpen: (id: string) => void;
    mytkoEnabled: boolean;
    /** IMP-25-20: строка выбрана для массовых операций */
    selected?: boolean;
    /** IMP-25-20: переключить выбор строки */
    onToggleSelect?: (id: string, checked: boolean) => void;
  }) {
    return (
      /* IMP-25-20: карточка-строка обёрнута в div — чекбокс массового выбора живёт
         РЯДОМ с кнопкой строки (checkbox внутри button — невалидный HTML) */
      <div
        className={cn(
          'flex w-full items-center gap-1 rounded-xl border bg-card p-1.5 shadow-sm transition-[box-shadow,background-color] hover:bg-muted/60 hover:shadow-md',
          order.status === 'new' && 'border-amber-300/70 dark:border-amber-500/40',
          selected && 'border-primary/50 bg-primary/5'
        )}
      >
        <label className="flex h-11 w-7 shrink-0 cursor-pointer items-center justify-center sm:h-9">
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onToggleSelect?.(order.id, v === true)}
            aria-label={`Выбрать заявку №${order.number} для массовых действий`}
          />
        </label>
        <button
          onClick={() => onOpen(order.id)}
          aria-label={`Открыть заявку №${order.number} — ${order.address || order.clientName || 'без адреса'}`}
          className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg p-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
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
          {/* IMP-24-FE1-02/06: экипаж и КП реестра — маленькие бейджи в мета-строке */}
          {order.crew?.name && (
            <span
              className="flex items-center gap-0.5 font-medium"
              title={`Экипаж: ${order.crew.name}${order.crew.phone ? ` · ${order.crew.phone}` : ''}`}
            >
              <Truck className="h-3 w-3" aria-hidden /> {order.crew.name}
            </span>
          )}
          {order.areaLkCode && (
            <Badge
              variant="outline"
              className="shrink-0 border-teal-300/70 bg-teal-500/10 px-1.5 text-[10px] text-teal-700 dark:border-teal-500/30 dark:text-teal-300"
              title={`Совмещена с КП реестра ${order.areaLkCode}`}
            >
              КП {order.areaLkCode}
            </Badge>
          )}
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
      </div>
    );
  },
  (a, b) =>
    a.onOpen === b.onOpen &&
    a.mytkoEnabled === b.mytkoEnabled &&
    a.selected === b.selected && // IMP-25-20
    a.onToggleSelect === b.onToggleSelect && // IMP-25-20
    a.order.id === b.order.id &&
    a.order.number === b.order.number &&
    a.order.type === b.order.type &&
    a.order.status === b.order.status &&
    a.order.address === b.order.address &&
    a.order.city === b.order.city &&
    a.order.clientName === b.order.clientName &&
    a.order.phone === b.order.phone &&
    a.order.size === b.order.size &&
    a.order.wishDate === b.order.wishDate &&
    a.order.lat === b.order.lat &&
    a.order.lng === b.order.lng &&
    a.order.createdAt === b.order.createdAt &&
    a.order.messagesCount === b.order.messagesCount &&
    a.order.mytkoStatus === b.order.mytkoStatus &&
    a.order.crewId === b.order.crewId &&
    a.order.crew?.name === b.order.crew?.name &&
    a.order.areaLkCode === b.order.areaLkCode
);

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
  // IMP-F14: вкладка/фильтры/поиск сохраняются в localStorage (bstudio.orders.*)
  const [tab, setTab] = useState<Tab>(() => {
    const v = typeof window === 'undefined' ? null : readStored('bstudio.orders.tab');
    return v === 'map' || v === 'active' || v === 'archive' ? v : 'map';
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [placementId, setPlacementId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; tick: number } | null>(null);
  const [showCompleted, setShowCompleted] = useState<boolean>(() => {
    const v = typeof window === 'undefined' ? null : readStored('bstudio.orders.showCompleted');
    return v == null ? true : v === '1';
  });
  const [typeFilter, setTypeFilter] = useState<'all' | 'waste' | 'kgm'>(() => {
    const v = typeof window === 'undefined' ? null : readStored('bstudio.orders.typeFilter');
    return v === 'waste' || v === 'kgm' ? v : 'all';
  });
  /** FE22-03: фильтр по дате создания — клиентский, persist bstudio.orders.dateFilter */
  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'all'>(() => {
    const v = typeof window === 'undefined' ? null : readStored('bstudio.orders.dateFilter');
    return v === 'today' || v === 'week' ? v : 'all';
  });
  const [search, setSearch] = useState<string>(() =>
    typeof window === 'undefined' ? '' : (readStored('bstudio.orders.search') ?? '')
  );
  const [newOpen, setNewOpen] = useState(false);
  const [mytkoEnabled, setMytkoEnabled] = useState(false);
  /** FE22-10: busy кнопки экспорта CSV */
  const [exporting, setExporting] = useState(false);
  // IMP-F15: свежесть данных и индикация потери связи
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [connLost, setConnLost] = useState(false);
  const failStreakRef = useRef(0);
  const [nowTs, setNowTs] = useState(() => Date.now());
  // IMP-24-FE1-02: справочник экипажей (общий для карточки заявки и диалога управления)
  const [crews, setCrews] = useState<CrewDto[]>([]);
  const [crewsOpen, setCrewsOpen] = useState(false);
  // IMP-24-FE1-05: карточка КП (открывается кликом по КП-маркеру на карте)
  const [kpDialogArea, setKpDialogArea] = useState<AreaItem | null>(null);
  // IMP-25-21: фильтр по экипажу ('all' | 'none' | crewId) + полное число заявок (total)
  const [crewFilter, setCrewFilter] = useState<string>(
    () => (typeof window === 'undefined' ? null : readStored('bstudio.orders.crewFilter')) ?? 'all'
  );
  const [ordersTotal, setOrdersTotal] = useState(0);
  // IMP-25-20: массовые операции — выбор строк + параметры пачки
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkStatus, setBulkStatus] = useState('none'); // 'none' — статус не менять
  const [bulkCrewId, setBulkCrewId] = useState('keep'); // 'keep' — не менять; '__clear' — без экипажа
  const [bulkApplying, setBulkApplying] = useState(false);
  /** IMP-25-20: пачка, ожидающая подтверждения (массовый финальный статус) */
  const [bulkConfirm, setBulkConfirm] = useState<{ ids: string[]; status: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{
        orders: OrderDto[];
        mytkoEnabled?: boolean;
        total?: number; // IMP-25-21: все заявки бота (список может быть обрезан take)
      }>(`/api/bots/${bot.id}/orders`);
      setOrders(d.orders);
      setMytkoEnabled(!!d.mytkoEnabled);
      // IMP-25-21: если бэк ещё не отдаёт total — считаем по списку (баннер скрыт)
      setOrdersTotal(typeof d.total === 'number' ? d.total : d.orders.length);
      setLastSyncAt(Date.now());
      failStreakRef.current = 0;
      setConnLost(false);
    } catch {
      /* ignore polling errors */
      failStreakRef.current += 1;
      if (failStreakRef.current >= 3) setConnLost(true);
    } finally {
      setLoading(false);
    }
  }, [bot.id]);

  // Поллинг (IMP-F15): пауза на document.hidden, при возврате на вкладку — немедленный тик
  useEffect(() => {
    load();
    let timer: ReturnType<typeof setInterval> | null = setInterval(load, 6000);
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      } else if (!timer) {
        load();
        timer = setInterval(load, 6000);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  // Тикер для чипа «обновлено N с назад» (лёгкий, раз в 5 с)
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  // IMP-F14: запись UI-состояния в localStorage
  useEffect(() => {
    writeStored('bstudio.orders.tab', tab);
  }, [tab]);
  useEffect(() => {
    writeStored('bstudio.orders.typeFilter', typeFilter);
  }, [typeFilter]);
  useEffect(() => {
    writeStored('bstudio.orders.dateFilter', dateFilter);
  }, [dateFilter]);
  useEffect(() => {
    writeStored('bstudio.orders.showCompleted', showCompleted ? '1' : '0');
  }, [showCompleted]);
  useEffect(() => {
    writeStored('bstudio.orders.search', search);
  }, [search]);
  // IMP-25-21: фильтр экипажа переживает перезагрузку (bstudio.orders.crewFilter)
  useEffect(() => {
    writeStored('bstudio.orders.crewFilter', crewFilter);
  }, [crewFilter]);
  // IMP-25-20: смена вкладки сбрасывает массовый выбор (невидимые выбранные строки путают)
  useEffect(() => {
    setSelectedIds(new Set());
  }, [tab]);
  // IMP-25-REV-7: смена поиска/фильтров тоже сбрасывает массовый выбор —
  // иначе «Применить» бьёт по строкам, которых пользователь уже не видит
  useEffect(() => {
    setSelectedIds(new Set());
  }, [search, typeFilter, dateFilter, crewFilter]);

  // IMP-24-FE1-02: справочник экипажей — без поллинга; обновляем при открытии
  // карточки заявки и диалога управления (ошибки не критичны)
  const loadCrews = useCallback(async () => {
    try {
      const d = await api<{ items: CrewDto[] }>(`/api/bots/${bot.id}/crews`);
      const items = d.items ?? [];
      setCrews(items);
      // IMP-25-21: удалённый экипаж в сохранённом фильтре не должен прятать все заявки
      setCrewFilter((cur) =>
        cur === 'all' || cur === 'none' || items.some((c) => c.id === cur) ? cur : 'all'
      );
    } catch {
      /* справочник не критичен — карточка заявки работает и без него */
    }
  }, [bot.id]);

  // IMP-25-21: справочник нужен и фильтру «Экипаж» — грузим при входе в раздел (без поллинга)
  useEffect(() => {
    void loadCrews();
  }, [loadCrews]);

  const openOrder = useCallback(
    (id: string) => {
      setSelectedId(id);
      setDialogOpen(true);
      void loadCrews();
    },
    [loadCrews]
  );

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

  // IMP-23-MAP-01: очистка focus-состояния карты — OrdersMap вызывает после перелёта,
  // чтобы focus не жил вечно (одноразовость сохраняет tick)
  const clearMapFocus = useCallback(() => setFocus(null), []);

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
      } catch (e) {
        // IMP-25-22: причина ошибки — в тосте, не глотаем
        toast({
          title: 'Не удалось сохранить точку',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      }
    },
    [placementId, bot.id, load, toast]
  );

  // IMP-24-FE1-05: выбранная заявка (для карточки КП) + совмещение КП с заявкой
  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedId) ?? null,
    [orders, selectedId]
  );

  const openKpDialog = useCallback((area: AreaItem) => setKpDialogArea(area), []);

  const attachKpToOrder = useCallback(
    async (area: AreaItem, orderId: string) => {
      try {
        const d = await api<{ order: OrderDto }>(`/api/bots/${bot.id}/orders/${orderId}`, {
          method: 'PATCH',
          body: JSON.stringify({ areaLkCode: area.lkCode }),
        });
        setOrders((prev) => prev.map((o) => (o.id === orderId ? d.order : o)));
        setKpDialogArea(null);
        toast({ title: `Заявка №${d.order.number} совмещена с КП ${area.lkCode}` });
      } catch (e) {
        // IMP-25-22: причина ошибки (валидация lk-кода/сеть) — в тосте
        toast({
          title: 'Не удалось совместить с КП',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      }
    },
    [bot.id, toast]
  );

  /** IMP-25-19: отвязать заявку от текущей КП (кнопка «Отвязать» в KpDialog) */
  const detachKpFromOrder = useCallback(
    async (order: OrderDto) => {
      try {
        const d = await api<{ order: OrderDto }>(`/api/bots/${bot.id}/orders/${order.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ areaLkCode: null }),
        });
        setOrders((prev) => prev.map((o) => (o.id === d.order.id ? d.order : o)));
        toast({ title: `Заявка №${d.order.number} отвязана от КП` });
      } catch (e) {
        toast({
          title: 'Не удалось отвязать КП',
          description: e instanceof Error ? e.message : undefined, // IMP-25-22
          variant: 'destructive',
        });
      }
    },
    [bot.id, toast]
  );

  // ── IMP-25-20: массовые операции над выбранными заявками ────────────────────

  const toggleSelectOrder = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setBulkStatus('none');
    setBulkCrewId('keep');
  }, []);

  const applyBulk = useCallback(
    async (ids: string[], status: string, crewId: string) => {
      if (ids.length === 0) return;
      const body: Record<string, unknown> = { ids };
      if (status !== 'none') body.status = status;
      // контракт бэка волны 25: crewId — string|null (null = «Без экипажа»)
      if (crewId === '__clear') body.crewId = null;
      else if (crewId !== 'keep') body.crewId = crewId;
      if (!('status' in body) && !('crewId' in body)) {
        toast({ title: 'Выберите статус или экипаж для применения' });
        return;
      }
      setBulkApplying(true);
      try {
        const d = await api<{ ok: boolean; updated: number; skipped: number; crewUpdated?: number }>(
          `/api/bots/${bot.id}/orders/bulk`,
          { method: 'POST', body: JSON.stringify(body) }
        );
        const updated = d.updated ?? 0;
        const skipped = d.skipped ?? 0;
        const crewUpdated = d.crewUpdated ?? 0; // IMP-25-REV-1: crew-only пачка по финальным статусам не меняет статусы, но экипаж применён
        const parts = [
          skipped > 0 ? `Пропущено: ${skipped}` : null,
          crewUpdated > 0 ? `Экипаж назначен: ${crewUpdated}` : null,
        ].filter(Boolean);
        if (updated === 0 && skipped > 0 && crewUpdated === 0) {
          toast({
            title: 'Ни одна заявка не обновлена',
            description: `Пропущено: ${skipped} — недопустимый переход статуса`,
            variant: 'destructive',
          });
        } else {
          toast({
            title: crewUpdated > 0 && updated === 0 ? `Экипаж назначен заявок: ${crewUpdated}` : `Обновлено заявок: ${updated}`,
            description: parts.length ? parts.join(' · ') : undefined,
          });
        }
        await load();
        clearSelection();
      } catch (e) {
        toast({
          title: 'Массовое обновление не удалось',
          description: e instanceof Error ? e.message : undefined, // IMP-25-22: причина
          variant: 'destructive',
        });
      } finally {
        setBulkApplying(false);
      }
    },
    [bot.id, load, toast, clearSelection]
  );

  const handleBulkApply = useCallback(() => {
    // IMP-25-REV-7: применяется только к реально загруженным заявкам;
    // выделение сбрасывается при смене фильтров (эффект выше) — невидимых выбранных не остаётся
    const ids = [...selectedIds].filter((id) => orders.some((o) => o.id === id));
    if (ids.length === 0) return;
    if (bulkStatus === 'none' && bulkCrewId === 'keep') {
      toast({ title: 'Выберите статус или экипаж' });
      return;
    }
    // IMP-25-20: массовое закрытие/архивирование — осознанное действие (гвард как в карточке)
    if (bulkStatus !== 'none' && (FINAL_ORDER_STATUSES as readonly string[]).includes(bulkStatus)) {
      setBulkConfirm({ ids, status: bulkStatus });
      return;
    }
    void applyBulk(ids, bulkStatus, bulkCrewId);
  }, [selectedIds, orders, bulkStatus, bulkCrewId, applyBulk, toast]);

  /** FE22-10: выгрузка CSV — с сервера приходит готовый файл (status/from/to);
   *  из клиентских фильтров отдаём диапазон даты создания (фильтр FE22-03) */
  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const sp = new URLSearchParams();
      // экспорт-роут ждёт ISO/дату — отдаём ISO-строку границы диапазона
      if (dateFilter === 'today')
        sp.set('from', new Date(new Date().setHours(0, 0, 0, 0)).toISOString());
      if (dateFilter === 'week')
        sp.set('from', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      // IMP-25-REV-8: экспорт уважает активный фильтр типа и экипажа
      if (typeFilter !== 'all') sp.set('type', typeFilter);
      if (crewFilter === 'none') sp.set('crew', 'none');
      else if (crewFilter !== 'all') sp.set('crewId', crewFilter);
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`/api/bots/${bot.id}/orders/export?${sp}`, { headers });
      if (!res.ok) throw new Error(`export ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: 'CSV выгружен' });
    } catch {
      toast({ title: 'Не удалось выгрузить CSV', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }, [bot.id, dateFilter, toast]);

  // IMP-25-21: экипажи для фильтра/bulk-бара — активные первыми, по алфавиту
  const crewsSorted = useMemo(
    () =>
      [...crews].sort((a, b) =>
        a.active === b.active ? a.name.localeCompare(b.name, 'ru') : a.active ? -1 : 1
      ),
    [crews]
  );

  // IMP-F12: все производные списки — один useMemo (раньше filtered() вызывался дважды за рендер)
  const { active, archive, newCount, withoutGeo, mapOrders, listOrders } = useMemo(() => {
    const active = orders.filter((o) => ACTIVE_STATUSES.includes(o.status));
    const archive = orders.filter((o) => ARCHIVE_STATUSES.includes(o.status));
    const q = search.trim().toLowerCase();
    const applyFilters = (list: OrderDto[]) => {
      let r = list;
      if (typeFilter !== 'all') r = r.filter((o) => o.type === typeFilter);
      if (dateFilter !== 'all') {
        const from =
          dateFilter === 'today'
            ? new Date().setHours(0, 0, 0, 0)
            : Date.now() - 7 * 24 * 60 * 60 * 1000;
        r = r.filter((o) => new Date(o.createdAt).getTime() >= from);
      }
      // IMP-25-21: фильтр по экипажу (all / none / конкретный crew)
      if (crewFilter === 'none') r = r.filter((o) => o.crewId == null);
      else if (crewFilter !== 'all') r = r.filter((o) => o.crewId === crewFilter);
      if (q) {
        r = r.filter(
          (o) =>
            String(o.number).includes(q) ||
            (o.address ?? '').toLowerCase().includes(q) ||
            (o.clientName ?? '').toLowerCase().includes(q) ||
            (o.phone ?? '').toLowerCase().includes(q) ||
            (o.crew?.name ?? '').toLowerCase().includes(q) || // IMP-25-21
            (o.areaLkCode ?? '').toLowerCase().includes(q) || // IMP-25-21
            (o.areaAddress ?? '').toLowerCase().includes(q) // IMP-25-21
        );
      }
      return r;
    };
    return {
      active,
      archive,
      newCount: orders.filter((o) => o.status === 'new').length,
      withoutGeo: orders.filter((o) => o.lat == null && ACTIVE_STATUSES.includes(o.status)),
      mapOrders: applyFilters(orders),
      listOrders: tab === 'active' ? applyFilters(active) : applyFilters(archive),
    };
  }, [orders, typeFilter, dateFilter, search, crewFilter, tab]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Хедер */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2.5 sm:px-4 sm:py-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onBack} aria-label="Назад к дашборду">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <MapPin className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        <h1 className="shrink-0 text-lg font-bold tracking-tight sm:text-2xl">Заявки</h1>
        <Badge variant="secondary" className="max-w-[130px] truncate sm:max-w-[180px]">
          {bot.name}
        </Badge>
        {newCount > 0 && (
          <Badge variant="destructive" className="tabular-nums animate-pulse" aria-label={`Новых заявок: ${newCount}`}>
            новых: {newCount}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          {lastSyncAt != null && !connLost && (
            <span
              role="status"
              aria-label={`Данные обновлены: ${fmtAgo(lastSyncAt, nowTs)}`}
              className="hidden text-[11px] text-muted-foreground sm:inline"
            >
              обновлено {fmtAgo(lastSyncAt, nowTs)}
            </span>
          )}
          <Button variant="outline" size="sm" className="h-8" onClick={load} aria-label="Обновить список заявок">
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Обновить</span>
          </Button>
          <Button size="sm" className="h-8" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Новая</span> Заявка
          </Button>
        </div>
      </div>

      {/* Потеря связи (IMP-F15): поллинг продолжается, баннер после 3 сбоев подряд */}
      {connLost && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-center gap-2 border-b border-amber-300/70 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 sm:px-4"
        >
          <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Нет связи с сервером — повторяем попытку обновления…
        </div>
      )}

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
        {/* IMP-25-21: фильтр по экипажу */}
        <Select value={crewFilter} onValueChange={setCrewFilter}>
          <SelectTrigger className="h-9 w-[140px] sm:w-[160px]" aria-label="Фильтр по экипажу">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все экипажи</SelectItem>
            <SelectItem value="none">Без экипажа</SelectItem>
            {crewsSorted.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
                {!c.active && ' (неактивен)'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* FE22-03: фильтр по дате создания (клиентский, persist bstudio.orders.dateFilter) */}
        <div className="flex items-center gap-1" role="group" aria-label="Фильтр по дате создания">
          {(
            [
              { v: 'today', label: 'Сегодня' },
              { v: 'week', label: '7 дней' },
              { v: 'all', label: 'Всё' },
            ] as const
          ).map((d) => (
            <button
              key={d.v}
              type="button"
              onClick={() => setDateFilter(d.v)}
              aria-pressed={dateFilter === d.v}
              className={cn(
                'h-8 rounded-full px-2.5 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                dateFilter === d.v
                  ? 'border border-transparent bg-primary text-primary-foreground'
                  : 'border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
        {/* FE22-10: экспорт CSV — готовый файл с сервера, с учётом фильтра дат */}
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={exportCsv}
          disabled={exporting}
          aria-label="Экспорт заявок в CSV"
        >
          {exporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">CSV</span>
        </Button>
        {tab === 'map' && (
          <Label
            htmlFor="orders-show-completed"
            className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-normal text-muted-foreground"
          >
            <Checkbox
              id="orders-show-completed"
              checked={showCompleted}
              onCheckedChange={(v) => setShowCompleted(v === true)}
              aria-label="Показывать выполненные заявки на карте"
            />
            выполненные на карте
          </Label>
        )}
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            type="search"
            aria-label="Поиск заявок по номеру, адресу, клиенту, телефону, экипажу или КП" // IMP-25-21
            placeholder="№, адрес, клиент, экипаж, КП…"
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
                orders={mapOrders}
                showCompleted={showCompleted}
                mytkoEnabled={mytkoEnabled}
                placementOrderId={placementId}
                selectedId={selectedId}
                focusOrderId={focus?.id ?? null}
                focusTick={focus?.tick ?? 0}
                onFocusDone={clearMapFocus}
                botId={bot.id}
                onSelect={openOrder}
                onPlace={placeOnMap}
                onHighlight={setSelectedId}
                onKpSelect={openKpDialog}
                selectedAreaLkCode={selectedOrder?.areaLkCode ?? null} // IMP-25-19
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
            {/* IMP-25-21: бэк волны 25 отдаёт total — если заявок больше, чем в списке, честно скажем */}
            {ordersTotal > orders.length && (
              <p role="note" className="px-1 pb-1.5 text-xs tabular-nums text-muted-foreground">
                Показаны {orders.length} из {ordersTotal} заявок (в списках отображаются последние)
              </p>
            )}
            {/* IMP-25-20: bulk-бар массовых операций */}
            {selectedIds.size > 0 && (
              <div
                role="toolbar"
                aria-label="Массовые операции над выбранными заявками"
                className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-2.5 py-2"
              >
                <span className="text-xs font-medium tabular-nums">Выбрано: {selectedIds.size}</span>
                <Select value={bulkStatus} onValueChange={setBulkStatus}>
                  <SelectTrigger className="h-9 w-[150px]" aria-label="Статус для выбранных заявок">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Статус: не менять</SelectItem>
                    {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={bulkCrewId} onValueChange={setBulkCrewId}>
                  <SelectTrigger className="h-9 w-[170px]" aria-label="Экипаж для выбранных заявок">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">Экипаж: не менять</SelectItem>
                    <SelectItem value="__clear">Без экипажа</SelectItem>
                    {crewsSorted.map((c) => (
                      <SelectItem key={c.id} value={c.id} disabled={!c.active}>
                        {c.name}
                        {!c.active && ' (неактивен)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" className="h-9" onClick={handleBulkApply} disabled={bulkApplying}>
                  {bulkApplying ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Check className="h-4 w-4" aria-hidden />
                  )}
                  Применить
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9"
                  onClick={clearSelection}
                  disabled={bulkApplying}
                >
                  Снять выделение
                </Button>
              </div>
            )}
            {loading ? (
              <div className="grid grid-cols-1 gap-2 p-1 lg:grid-cols-2" role="status" aria-label="Загрузка заявок">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-[68px] rounded-xl" />
                ))}
              </div>
            ) : listOrders.length === 0 ? (
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
                {listOrders.map((o) => (
                  <OrderRow
                    key={o.id}
                    order={o}
                    onOpen={openOrder}
                    mytkoEnabled={mytkoEnabled}
                    selected={selectedIds.has(o.id)} // IMP-25-20
                    onToggleSelect={toggleSelectOrder} // IMP-25-20
                  />
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
        crews={crews}
        onOpenCrews={() => {
          setCrewsOpen(true);
          void loadCrews();
        }}
      />
      {/* IMP-24-FE1-02: справочник экипажей (открывается из карточки заявки) */}
      <CrewsManagerDialog
        botId={bot.id}
        open={crewsOpen}
        onClose={() => setCrewsOpen(false)}
        crews={crews}
        setCrews={setCrews}
      />
      {/* IMP-24-FE1-05: карточка КП реестра (клик по КП-маркеру на карте) */}
      <KpDialog
        area={kpDialogArea}
        selectedOrder={selectedOrder}
        onClose={() => setKpDialogArea(null)}
        onAttach={attachKpToOrder}
        onDetach={detachKpFromOrder}
      />
      <NewOrderDialog
        botId={bot.id}
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(orderId) => {
          load();
          openOrder(orderId); // FE22-10: сразу открываем созданную заявку
        }}
      />
      {/* IMP-25-20: гвард массового перевода в финальный статус (закрытие/архив) */}
      <AlertDialog
        open={!!bulkConfirm}
        onOpenChange={(o) => {
          if (!o && !bulkApplying) setBulkConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Массовое изменение статуса на «{ORDER_STATUS_LABELS[bulkConfirm?.status ?? ''] ?? ''}»?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Заявок в пачке: {bulkConfirm?.ids.length ?? 0}. Заявки с недопустимым переходом
              (например, уже закрытые) будут пропущены — итог покажем в уведомлении.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkApplying}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                bulkConfirm?.status === 'cancelled' &&
                  'bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60'
              )}
              disabled={bulkApplying}
              onClick={(e) => {
                e.preventDefault(); // диалог закрываем сразу — busy виден в bulk-баре
                const c = bulkConfirm;
                setBulkConfirm(null);
                if (c) void applyBulk(c.ids, c.status, bulkCrewId);
              }}
            >
              {bulkApplying && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Применить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

'use client';

// IMP-23-TAB-04: вкладка «Реестр КП» — контейнерные площадки из интеграции MyTKO.
// Таблица на md+, карточки на мобильном; поиск с debounce 300 мс, фильтр по городу,
// CTA загрузки реестра (POST mytko {action:'sync-areas'}).
// IMP-26-08: у каждой КП кнопка «Показать на карте» — dispatch 'bstudio:kp-focus'
// {detail:{area}} с ПОЛНЫМ AreaItem (приёмную часть делает FE1: app-root →
// setView('orders') → карта летит к КП и открывает KpDialog — здесь знать не надо).
// IMP-26-09: merge-пагинация «Показать ещё» (take=100, дедуп по lkCode, кап отрисовки 500)
// вместо постраничных «Назад/Вперёд».
// IMP-26-10: AbortController-гигиена load() — stale-ответы быстрого поиска отменяются.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ExternalLink,
  Loader2,
  MapPin,
  MapPinned,
  RotateCcw,
  Search,
  SearchCheck,
  WifiOff,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import type { AreaItem, AreasResponse } from '@/lib/studio-types';
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
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { SERVICE_CITIES } from '@/lib/cities';

// IMP-26-09: merge-догрузка по 100 за запрос (API: DEFAULT_TAKE 50, MAX_TAKE 500)
const PAGE_TAKE = 100;
// IMP-26-09: кап отрисовки — накопленное свыше не рендерим, показываем честную подпись
const RENDER_CAP = 500;
const ALL_CITIES = '__all__';

/** Метаданные реестра из AreasResponse (items накапливаются отдельным state) */
type AreasMeta = Pick<AreasResponse, 'areasSyncedAt' | 'areasCount'>;

/** Ссылка на площадку в OpenStreetMap (только при наличии координат) */
function osmUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Координаты текстом: «58.52260, 31.27000» */
function fmtCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function CoordsCell({ area }: { area: AreaItem }) {
  if (area.lat == null || area.lng == null) {
    return (
      <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
        нет координат
      </Badge>
    );
  }
  return (
    <span className="tabular-nums text-xs text-muted-foreground">
      {fmtCoords(area.lat, area.lng)}
    </span>
  );
}

/** Иконка-ссылка на OSM; на мобиле — касаемая (44px) */
function OsmLink({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  return (
    <a
      href={osmUrl(lat, lng)}
      target="_blank"
      rel="noreferrer"
      aria-label={`Площадка «${label}» на карте OpenStreetMap`}
      title="Открыть в OpenStreetMap"
      className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:w-8"
    >
      <ExternalLink className="h-4 w-4" aria-hidden />
    </a>
  );
}

// IMP-26-08: диспетч события «показать КП на карте заявок». Контракт волны 26:
// приёмник (FE1, app-root) слушает 'bstudio:kp-focus', переключает view на заявки,
// летит к точке и открывает KpDialog. Отправляем ПОЛНЫЙ AreaItem из реестра.
function dispatchKpFocus(area: AreaItem): void {
  window.dispatchEvent(new CustomEvent('bstudio:kp-focus', { detail: { area } }));
}

/** IMP-26-08: кнопка «Показать на карте» рядом с OsmLink; без координат — disabled */
function KpFocusButton({ area }: { area: AreaItem }) {
  const hasCoords = area.lat != null && area.lng != null;
  return (
    <button
      type="button"
      onClick={() => dispatchKpFocus(area)}
      disabled={!hasCoords}
      aria-disabled={!hasCoords}
      aria-label={`Показать КП ${area.lkCode} на карте заявок`}
      title={hasCoords ? 'Показать на карте заявок' : 'Нет координат — покажите по ссылке OSM'}
      className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-teal-700 transition-colors hover:bg-teal-500/10 hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:text-teal-400 dark:hover:bg-teal-500/15 dark:hover:text-teal-300 md:h-8 md:w-8"
    >
      <MapPin className="h-4 w-4" aria-hidden />
    </button>
  );
}

/** Пустое состояние (иконка + заголовок + пояснение) */
function EmptyState({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: typeof MapPinned;
  title: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <div className="max-w-[320px]">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}

export default function AreasView({
  botId,
  onBack,
}: {
  botId: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [city, setCity] = useState(ALL_CITIES);
  const [page, setPage] = useState(1);
  // IMP-26-09: накопление вместо replace — страница 1 замещает список (смена фильтров/синк),
  // «Показать ещё» аппендит следующую страницу с дедупом по lkCode
  const [areas, setAreas] = useState<AreaItem[]>([]);
  const [total, setTotal] = useState(0); // IMP-26-09: честный total из ответа API (data.total)
  const [meta, setMeta] = useState<AreasMeta | null>(null); // areasSyncedAt/areasCount из ответа
  const [loading, setLoading] = useState(true);
  // IMP-26-10: актуальный AbortController для load() — паттерн kpAbortRef в orders-view:439-443
  const areaAbortRef = useRef<AbortController | null>(null);
  // IMP-26-09: синхронный гвард от double-click «Показать ещё» — без него два клика до
  // перерендера дают page+2 (пропуск целой страницы из 100 КП — дедуп их не вернёт)
  const loadingMoreRef = useRef(false);
  const [error, setError] = useState(false);
  // IMP-23-REV-6 (reviewer NIT-2): индикатор фоновой подгрузки (смена страницы/поиска)
  const [fetching, setFetching] = useState(false);
  // Синк реестра занимает ~минуту — busy-состояние с прогресс-текстом
  const [syncing, setSyncing] = useState(false);
  // IMP-26-09: триггер принудительной перезагрузки (после синка) — стр. 1, replace
  const [reloadKey, setReloadKey] = useState(0);

  // Debounce 300 мс: query → appliedQ; новый поиск всегда сбрасывает страницу
  useEffect(() => {
    const t = setTimeout(() => {
      setAppliedQ(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const onCityChange = (v: string) => {
    setCity(v);
    setPage(1);
  };

  const load = useCallback(
    async (targetPage: number) => {
      // IMP-26-10: предыдущий запрос отменяем — быстрая печать поиска больше не даёт гонок
      areaAbortRef.current?.abort();
      const ac = new AbortController();
      areaAbortRef.current = ac;
      setFetching(true);
      try {
        const params = new URLSearchParams();
        params.set('page', String(targetPage));
        params.set('take', String(PAGE_TAKE));
        if (appliedQ) params.set('q', appliedQ);
        if (city !== ALL_CITIES) params.set('city', city);
        const d = await api<AreasResponse>(`/api/bots/${botId}/mytko/areas?${params.toString()}`, {
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        // IMP-26-09: стр. 1 — replace (смена фильтров/синк), далее merge-догрузка
        // с дедупом по lkCode (Set) — реестр мог измениться между страницами
        setAreas((prev) => {
          if (targetPage <= 1) return d.items ?? [];
          const seen = new Set(prev.map((a) => a.lkCode));
          const fresh = (d.items ?? []).filter((a) => !seen.has(a.lkCode));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
        setTotal(d.total ?? d.items?.length ?? 0); // честный total из ответа API
        setMeta({ areasSyncedAt: d.areasSyncedAt, areasCount: d.areasCount });
        setError(false);
      } catch {
        // IMP-26-10: отмена (AbortError) — не ошибка, error-state не показываем
        if (ac.signal.aborted) return;
        setError(true);
      } finally {
        // IMP-26-10: индикаторы сбрасывает только АКТУАЛЬНАЯ загрузка (см. kpAbortRef)
        if (areaAbortRef.current === ac) {
          setLoading(false);
          setFetching(false);
          loadingMoreRef.current = false; // IMP-26-09: страница загружена — можно просить следующую
        }
      }
    },
    [botId, appliedQ, city]
  );

  useEffect(() => {
    void load(page);
    // IMP-26-10: unmount/смена зависимостей — отменяем висящий запрос
    return () => {
      areaAbortRef.current?.abort();
      areaAbortRef.current = null;
    };
  }, [load, page, reloadKey]);

  /** CTA «Загрузить реестр» / «Обновить реестр»: POST mytko {action:'sync-areas'}
   *  (как syncAreas в MytkoCard — без подтверждения реавторизации). */
  const syncAreas = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const d = await api<{ ok: boolean; count?: number; error?: string }>(`/api/bots/${botId}/mytko`, {
        method: 'POST',
        body: JSON.stringify({ action: 'sync-areas' }),
      });
      if (d.ok) {
        toast({
          title: `Реестр КП загружен: ${d.count ?? 0} площадок`,
          description: 'Площадки из MyTKO теперь доступны здесь и в сверке заявок',
        });
        // IMP-26-09: после синка — сброс на первую страницу и replace-перезагрузка
        // (reloadKey гарантирует перезапуск даже если page уже был 1)
        setPage(1);
        setReloadKey((k) => k + 1);
      } else {
        toast({ title: `Ошибка: ${d.error ?? 'unknown'}`, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Не удалось загрузить реестр КП', variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  // IMP-26-09: кап отрисовки — накопленное свыше RENDER_CAP не рендерим (честная подпись над списком)
  const overCap = areas.length > RENDER_CAP;
  const visibleAreas = overCap ? areas.slice(0, RENDER_CAP) : areas;
  const registryEmpty = meta != null && meta.areasSyncedAt === null && meta.areasCount === 0;
  const isFiltered = appliedQ !== '' || city !== ALL_CITIES;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
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
            <MapPinned className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" aria-hidden />
            Реестр КП
          </h1>
          <p className="truncate text-xs text-muted-foreground sm:text-sm">
            Контейнерные площадки MyTKO
          </p>
        </div>
        {meta != null && meta.areasSyncedAt !== null && (
          <Button
            variant="outline"
            className="min-h-11 shrink-0 sm:min-h-9"
            onClick={() => void syncAreas()}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="h-4 w-4" aria-hidden />
            )}
            <span className="hidden sm:inline">Обновить реестр</span>
            <span className="sm:hidden">Обновить</span>
          </Button>
        )}
      </div>

      {/* Шапка-статистика */}
      <div className="border-b bg-background px-3 py-2.5 sm:px-4">
        {loading && meta == null ? (
          <div className="flex gap-2" aria-hidden>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-6 w-28" />
          </div>
        ) : meta != null ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground sm:text-[13px]">
            <span>
              Площадок в реестре:{' '}
              <span className="font-semibold text-foreground tabular-nums">{meta.areasCount}</span>
            </span>
            {meta.areasSyncedAt !== null ? (
              <span className="tabular-nums" title="Когда реестр загружался из MyTKO">
                Обновлён: {fmtDateTime(meta.areasSyncedAt)}
              </span>
            ) : (
              <Badge
                variant="outline"
                className="h-5 border-amber-200 bg-amber-50 px-1.5 text-[10px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300"
              >
                Реестр не загружен
              </Badge>
            )}
            {syncing && (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Загружаем реестр из MyTKO… это занимает около минуты
              </span>
            )}
          </div>
        ) : null}
      </div>

      {/* Панель фильтров */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2 sm:px-4">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="h-11 pl-8 text-sm sm:h-9"
            placeholder="Код КП или адрес…"
            aria-label="Поиск площадки"
            value={query}
            disabled={syncing}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select value={city} onValueChange={onCityChange} disabled={syncing}>
          <SelectTrigger
            className="h-11 w-[150px] text-sm sm:h-9 sm:w-[190px]"
            aria-label="Город"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CITIES}>Все города</SelectItem>
            {SERVICE_CITIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {meta != null && meta.areasSyncedAt === null && meta.areasCount === 0 && (
          <Button
            className="min-h-11 sm:min-h-9"
            onClick={() => void syncAreas()}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <MapPinned className="h-4 w-4" aria-hidden />
            )}
            Загрузить реестр
          </Button>
        )}
      </div>

      {/* Список */}
      {fetching && meta != null && (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden" role="progressbar" aria-label="Обновление списка">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-primary/70" />
        </div>
      )}
      {loading ? (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 sm:p-4" role="status" aria-label="Загрузка реестра">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <>
          <EmptyState
            icon={WifiOff}
            title="Не удалось загрузить реестр"
            hint="Проверьте связь и попробуйте ещё раз."
          />
          <div className="flex justify-center pb-4">
            <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => void load(page)}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Повторить
            </Button>
          </div>
        </>
      ) : registryEmpty ? (
        <EmptyState
          icon={MapPinned}
          title="Реестр пуст — загрузите из MyTKO"
          hint="Список контейнерных площадок подтягивается из личного кабинета MyTKO. Загрузка занимает около минуты."
        >
          <Button className="min-h-11 sm:min-h-9" onClick={() => void syncAreas()} disabled={syncing}>
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <MapPinned className="h-4 w-4" aria-hidden />
            )}
            {syncing ? 'Загружаем… около минуты' : 'Загрузить реестр'}
          </Button>
        </EmptyState>
      ) : areas.length === 0 ? (
        <EmptyState
          icon={SearchCheck}
          title="Ничего не найдено"
          hint={
            isFiltered
              ? 'Попробуйте изменить запрос или выбрать другой город.'
              : 'В реестре пока нет площадок — обновите его из MyTKO.'
          }
        />
      ) : (
        <>
          {/* Таблица (md+) */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4" aria-busy={syncing}>
            <div className="mx-auto max-w-4xl">
              {/* IMP-26-09: честный кап отрисовки накопленного списка */}
              {overCap && (
                <p role="note" className="mb-3 text-center text-xs text-muted-foreground">
                  Показаны первые {RENDER_CAP} из {total} найденных — уточните поиск
                </p>
              )}
              <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Контейнерные площадки MyTKO: код, адрес, координаты
                  </caption>
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Код КП
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Адрес
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Координаты
                      </th>
                      <th scope="col" className="w-[84px] px-2 py-2.5">
                        <span className="sr-only">Показать на карте и ссылка OSM</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {visibleAreas.map((a) => (
                      <tr key={a.lkCode} className="transition-colors hover:bg-muted/40">
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs font-semibold">
                          {a.lkCode}
                        </td>
                        <td className="px-4 py-2.5">
                          {a.address ?? <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <CoordsCell area={a} />
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          {/* IMP-26-08: фокус на карте заявок (без координат — disabled) + OSM */}
                          <div className="flex items-center justify-end gap-0.5">
                            <KpFocusButton area={a} />
                            {a.lat != null && a.lng != null && (
                              <OsmLink lat={a.lat} lng={a.lng} label={a.address ?? a.lkCode} />
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Карточки (мобильный) */}
              <div className="space-y-2 md:hidden">
                {visibleAreas.map((a) => (
                  <article key={a.lkCode} className="rounded-xl border bg-card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold">{a.lkCode}</span>
                      {/* IMP-26-08: фокус на карте заявок (без координат — disabled) + OSM */}
                      <div className="flex items-center gap-0.5">
                        <KpFocusButton area={a} />
                        {a.lat != null && a.lng != null && (
                          <OsmLink lat={a.lat} lng={a.lng} label={a.address ?? a.lkCode} />
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-sm leading-snug">
                      {a.address ?? <span className="text-muted-foreground">Адрес не указан</span>}
                    </p>
                    <div className="mt-1.5">
                      <CoordsCell area={a} />
                    </div>
                  </article>
                ))}
              </div>

              {/* IMP-26-09: merge-пагинация — счётчик + «Показать ещё» вместо постраничных кнопок */}
              <div className="mt-4 flex flex-col items-center gap-2">
                <p className="text-center text-xs text-muted-foreground tabular-nums">
                  {/* IMP-26-REV-3: «Загружено», не «Показано» — рендер может быть ограничен капом (note выше) */}
                  Загружено {areas.length} из {total}
                </p>
                <Button
                  variant="outline"
                  className="min-h-11 px-4 sm:min-h-9"
                  disabled={areas.length >= total || loading || fetching || syncing}
                  onClick={() => {
                    if (loadingMoreRef.current) return; // IMP-26-09: гвард double-click
                    loadingMoreRef.current = true;
                    setPage((p) => p + 1);
                  }}
                >
                  {fetching ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <ChevronDown className="h-4 w-4" aria-hidden />
                  )}
                  Показать ещё
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  Inbox,
  LayoutDashboard,
  Loader2,
  LogOut,
  MapPin,
  Moon,
  Plug,
  Sparkles,
  Sun,
  Workflow,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { api, clearAuthToken } from '@/lib/client-api';
import type { SessionUser, BotListItem, ViewKey } from '@/lib/studio-types';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import LoginView from './login-view';
import Shell from './shell';
import Dashboard from './dashboard';
import EditorView from './editor-view';
import AiAssistantView from './ai-assistant-view';
import ChannelsView from './channels-view';
import InboxView from './inbox-view';
import OrdersView from './orders-view';

interface NotificationsResponse {
  /** Серверное время ответа — курсор следующего опроса (не часы браузера!) */
  now: string;
  newOrders: {
    id: string;
    number: number;
    type: string;
    address: string | null;
    botId: string;
    botName: string;
  }[];
  newChats: {
    id: string;
    contact: string | null;
    source: string;
    botId: string;
    botName: string;
  }[];
  totals: { newOrders: number; openConvs: number };
}

/** Куда ведёт клик по уведомлению */
export type NotificationTarget = {
  kind: 'order' | 'chat';
  botId: string;
  botName: string;
  /** null — просто открыть раздел (сводное уведомление) */
  id: string | null;
};

/** Разделы, для которых нужен выбранный бот (в палитре — disabled без него) */
const BOT_VIEWS: ViewKey[] = ['editor', 'ai', 'channels', 'inbox', 'orders'];

// IMP-FE21-06: оболочка переживает reload — view и текущий бот в localStorage
const VIEW_LS_KEY = 'bstudio.view';
const BOT_LS_KEY = 'bstudio.botId';
const ALL_VIEWS: ViewKey[] = ['dashboard', 'editor', 'ai', 'channels', 'inbox', 'orders'];

function readStoredValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function clearPersistedShell() {
  try {
    window.localStorage.removeItem(VIEW_LS_KEY);
    window.localStorage.removeItem(BOT_LS_KEY);
  } catch {
    // localStorage недоступен — не критично
  }
}

const PALETTE_VIEWS: { key: ViewKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { key: 'editor', label: 'Конструктор', icon: Workflow },
  { key: 'ai', label: 'ИИ-ассистент', icon: Sparkles },
  { key: 'channels', label: 'Каналы', icon: Plug },
  { key: 'inbox', label: 'Входящие', icon: Inbox },
  { key: 'orders', label: 'Заявки', icon: MapPin },
];

/**
 * Палитра команд (Ctrl/Cmd+K, cmdk): переход по разделам, переключение
 * текущего бота, тумблер темы и выход. Список ботов грузится при первом
 * открытии и перезапрашивается, если данным больше BOTS_STALE_MS (IMP-FE21-05):
 * прежний список остаётся виден, пока едут свежие данные.
 */
const BOTS_STALE_MS = 30_000;

function CommandPalette({
  open,
  onOpenChange,
  view,
  onViewChange,
  currentBotId,
  onSelectBot,
  onLogout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: ViewKey;
  onViewChange: (v: ViewKey) => void;
  currentBotId: string | null;
  onSelectBot: (bot: BotListItem) => void;
  onLogout: () => void;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const [bots, setBots] = useState<BotListItem[] | null>(null);
  const fetchedAtRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      if (Date.now() - fetchedAtRef.current < BOTS_STALE_MS) return;
      try {
        const d = await api<{ bots: BotListItem[] }>('/api/bots');
        if (cancelled) return;
        setBots(d.bots);
        fetchedAtRef.current = Date.now();
      } catch {
        // при сбое оставляем прежний список (или пустой при первом открытии)
        if (!cancelled) setBots((prev) => prev ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  /** Выполнить действие и закрыть палитру */
  const run = (action: () => void) => {
    action();
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Палитра команд"
      description="Переход по разделам, переключение бота и быстрые действия"
    >
      <CommandInput placeholder="Введите команду или название бота…" aria-label="Поиск команды" />
      <CommandList>
        <CommandEmpty>Ничего не найдено</CommandEmpty>

        <CommandGroup heading="Разделы">
          {PALETTE_VIEWS.map((v) => (
            <CommandItem
              key={v.key}
              disabled={BOT_VIEWS.includes(v.key) && !currentBotId}
              onSelect={() => run(() => onViewChange(v.key))}
            >
              <v.icon aria-hidden="true" />
              <span className="truncate">{v.label}</span>
              {view === v.key && (
                <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                  текущий
                </span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Боты">
          {bots === null ? (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Загрузка ботов…
            </div>
          ) : bots.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">Ботов пока нет — создайте на дашборде</div>
          ) : (
            bots.map((b) => (
              <CommandItem key={b.id} value={b.name} onSelect={() => run(() => onSelectBot(b))}>
                <Bot aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                {currentBotId === b.id && (
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                    текущий
                  </span>
                )}
              </CommandItem>
            ))
          )}
        </CommandGroup>

        <CommandGroup heading="Действия">
          <CommandItem
            onSelect={() => run(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'))}
          >
            {resolvedTheme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            Переключить тему
          </CommandItem>
          <CommandItem onSelect={() => run(onLogout)}>
            <LogOut aria-hidden="true" />
            Выйти
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

/**
 * Фоновый наблюдатель: раз в 12 секунд спрашивает /api/notifications и
 * показывает тосты о новых заявках/диалогах + обновляет бейджи навигации.
 *
 * Анти-повторы: (1) курсор — СЕРВЕРНОЕ время из ответа (расхождение часов
 * браузера и сервера раньше делало одно и то же уведомление «новым» на
 * каждом опросе); (2) дедупликация по id — показанное уведомление больше
 * никогда не показывается повторно.
 */
function NotificationsWatcher({
  onTotals,
  onOpenTarget,
}: {
  onTotals: (t: { newOrders: number; openConvs: number }) => void;
  onOpenTarget: (t: NotificationTarget) => void;
}) {
  const { toast } = useToast();
  const sinceRef = useRef<string>(new Date().toISOString());
  const shownRef = useRef<Set<string>>(new Set());
  // IMP-FE21-24: подряд идущие сбои поллинга; с 3-го — один тост «нет связи»
  const failStreakRef = useRef(0);
  const offlineShownRef = useRef(false);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const d = await api<NotificationsResponse>(
          `/api/notifications?since=${encodeURIComponent(sinceRef.current)}`
        );
        if (stopped) return;
        // Успешный ответ — связь восстановилась, сбрасываем счётчик и флаг тоста
        failStreakRef.current = 0;
        offlineShownRef.current = false;
        sinceRef.current = d.now ?? new Date().toISOString();
        onTotals(d.totals);

        const freshOrders = d.newOrders.filter((o) => !shownRef.current.has(`order:${o.id}`));
        const freshChats = d.newChats.filter((c) => !shownRef.current.has(`chat:${c.id}`));
        for (const o of freshOrders) shownRef.current.add(`order:${o.id}`);
        for (const c of freshChats) shownRef.current.add(`chat:${c.id}`);
        if (freshOrders.length === 0 && freshChats.length === 0) return;

        const openBtn = (t: NotificationTarget, label = 'Открыть') => (
          <ToastAction altText={label} onClick={() => onOpenTarget(t)}>
            {label}
          </ToastAction>
        );

        if (freshOrders.length === 1) {
          const o = freshOrders[0];
          toast({
            title: `🆕 Новая заявка №${o.number}`,
            description: `${o.botName}${o.address ? ` · ${o.address}` : ''}`,
            duration: 8000,
            action: openBtn({ kind: 'order', botId: o.botId, botName: o.botName, id: o.id }, 'Открыть заявку'),
          });
        } else if (freshOrders.length > 1) {
          const first = freshOrders[0];
          toast({
            title: `🆕 Новых заявок: ${freshOrders.length}`,
            description: freshOrders
              .slice(0, 3)
              .map((o) => `№${o.number}${o.address ? ` — ${o.address}` : ''}`)
              .join('\n') + (freshOrders.length > 3 ? '\n…' : ''),
            duration: 8000,
            action: openBtn({ kind: 'order', botId: first.botId, botName: first.botName, id: first.id }, 'Открыть'),
          });
        }

        if (freshChats.length === 1) {
          const c = freshChats[0];
          toast({
            title: '💬 Новый диалог с клиентом',
            description: `${c.contact ?? 'Гость'} · ${c.botName}`,
            duration: 8000,
            action: openBtn({ kind: 'chat', botId: c.botId, botName: c.botName, id: c.id }, 'Открыть диалог'),
          });
        } else if (freshChats.length > 1) {
          const first = freshChats[0];
          toast({
            title: `💬 Новых диалогов: ${freshChats.length}`,
            description: freshChats
              .slice(0, 3)
              .map((c) => c.contact ?? 'Гость')
              .join(', '),
            duration: 8000,
            action: openBtn({ kind: 'chat', botId: first.botId, botName: first.botName, id: first.id }, 'Открыть'),
          });
        }
      } catch {
        // IMP-FE21-24: молча глотать сбои плохо — при 3 неудачах подряд
        // показываем ОДИН тост (не спамим: флаг offlineShown), при успехе — сброс.
        failStreakRef.current += 1;
        if (failStreakRef.current >= 3 && !offlineShownRef.current) {
          offlineShownRef.current = true;
          toast({
            title: 'Нет связи — обновления приостановлены',
            description: 'Проверьте интернет. Уведомления возобновятся автоматически.',
            variant: 'destructive',
            duration: 8000,
          });
        }
      }
    };
    poll();
    // Поллинг ставится на паузу, пока вкладка скрыта (document.hidden) —
    // экономим батарею и трафик; при возврате — немедленный тик + рестарт.
    let timer: ReturnType<typeof setInterval> | null = null;
    const stopTimer = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const startTimer = () => {
      if (timer === null) timer = setInterval(poll, 12000);
    };
    const onVisibility = () => {
      if (document.hidden) {
        stopTimer();
      } else {
        poll();
        startTimer();
      }
    };
    startTimer();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      stopTimer();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [onTotals, onOpenTarget, toast]);

  return null;
}

export default function AppRoot() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewKey>('dashboard');
  const [currentBot, setCurrentBot] = useState<BotListItem | null>(null);
  const [botsVersion, setBotsVersion] = useState(0);
  const [badges, setBadges] = useState({ newOrders: 0, openConvs: 0 });
  // Фокус из уведомления: открыть раздел и подсветить нужную заявку/диалог
  const [orderFocus, setOrderFocus] = useState<string | null>(null);
  const [chatFocus, setChatFocus] = useState<string | null>(null);
  // Палитра команд (Ctrl/Cmd+K)
  const [paletteOpen, setPaletteOpen] = useState(false);

  const refreshBots = useCallback(() => setBotsVersion((v) => v + 1), []);
  const onTotals = useCallback(
    (t: { newOrders: number; openConvs: number }) => setBadges(t),
    []
  );

  // Клик по уведомлению: подбираем настоящий объект бота и открываем
  // нужный раздел с фокусом на конкретной заявке/диалоге
  const openTarget = useCallback(async (t: NotificationTarget) => {
    const fallback: BotListItem = {
      id: t.botId,
      name: t.botName,
      description: null,
      status: 'published',
      createdAt: '',
      updatedAt: '',
      channelsCount: 0,
      conversationsCount: 0,
      channelTypes: [],
    };
    let bot: BotListItem = fallback;
    try {
      const d = await api<{ bots: BotListItem[] }>('/api/bots');
      bot = d.bots.find((b) => b.id === t.botId) ?? fallback;
    } catch {
      /* останется fallback */
    }
    setCurrentBot(bot);
    if (t.kind === 'order') {
      setView('orders');
      if (t.id) setOrderFocus(t.id);
    } else {
      setView('inbox');
      if (t.id) setChatFocus(t.id);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<{ user: SessionUser }>('/api/auth/me')
      .then(async (d) => {
        if (cancelled) return;
        setUser(d.user);

        // IMP-FE21-06: восстановление оболочки после reload.
        // Атомарно: ботозависимую view ставим только вместе с найденным ботом.
        const storedView = readStoredValue(VIEW_LS_KEY);
        const storedBotId = readStoredValue(BOT_LS_KEY);
        const viewValid =
          storedView !== null && (ALL_VIEWS as string[]).includes(storedView);

        if (storedBotId) {
          try {
            // ОДИН запрос списка ботов — ищем сохранённый id
            const bd = await api<{ bots: BotListItem[] }>('/api/bots');
            if (cancelled) return;
            const bot = bd.bots.find((b) => b.id === storedBotId);
            if (bot) {
              setCurrentBot(bot);
              setView(
                viewValid && storedView !== 'dashboard'
                  ? (storedView as ViewKey)
                  : 'dashboard'
              );
              return;
            }
          } catch {
            /* сеть/сессия — считаем бота не восстановленным */
          }
          if (cancelled) return;
          // Бот не найден (удалён?) — бот не выбран, view возвращаем на дашборд;
          // persist-эффекты ниже запишут актуальные значения заново
          clearPersistedShell();
          setView('dashboard');
        } else if (viewValid) {
          // Без бота можно открыть только дашборд
          setView(BOT_VIEWS.includes(storedView as ViewKey) ? 'dashboard' : (storedView as ViewKey));
        }
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Если какой-то запрос вернул 401 (истёк токен и т.п.) — показываем вход
    const onUnauthorized = () => {
      setUser(null);
      setCurrentBot(null);
      setView('dashboard');
      clearPersistedShell();
    };
    window.addEventListener('bstudio:unauthorized', onUnauthorized);
    return () => {
      cancelled = true;
      window.removeEventListener('bstudio:unauthorized', onUnauthorized);
    };
  }, []);

  // IMP-FE21-06: сохраняем view и бота только у авторизованных
  useEffect(() => {
    if (!user) return;
    try {
      window.localStorage.setItem(VIEW_LS_KEY, view);
    } catch {
      /* ignore */
    }
  }, [view, user]);

  useEffect(() => {
    if (!user) return;
    const botId = currentBot?.id;
    if (!botId) return;
    try {
      window.localStorage.setItem(BOT_LS_KEY, botId);
    } catch {
      /* ignore */
    }
  }, [currentBot?.id, user]);

  const openBot = useCallback(
    (bot: BotListItem, target: ViewKey = 'editor') => {
      setCurrentBot(bot);
      setView(target);
    },
    []
  );

  /** Переключение текущего бота из палитры команд */
  const selectBotFromPalette = useCallback((bot: BotListItem) => {
    setCurrentBot(bot);
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    clearAuthToken();
    clearPersistedShell(); // IMP-FE21-06: view/бот не должны «переживать» выход
    setUser(null);
    setCurrentBot(null);
    setView('dashboard');
  }, []);

  // Ctrl/Cmd+K — открыть/закрыть палитру команд (только у авторизованных)
  useEffect(() => {
    if (!user) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user]);

  if (loading) {
    return (
      <div aria-busy="true" className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <div aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground animate-pulse">
          <Bot className="h-7 w-7" />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка студии…
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginView onLogin={setUser} />;
  }

  return (
    <Shell
      user={user}
      view={view}
      onViewChange={setView}
      currentBot={currentBot}
      badges={{ inbox: badges.openConvs, orders: badges.newOrders }}
      onOpenPalette={() => setPaletteOpen(true)}
      onLogout={logout}
    >
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        view={view}
        onViewChange={setView}
        currentBotId={currentBot?.id ?? null}
        onSelectBot={selectBotFromPalette}
        onLogout={logout}
      />
      <NotificationsWatcher onTotals={onTotals} onOpenTarget={openTarget} />
      {view === 'dashboard' && (
        <Dashboard
          key={`dash-${botsVersion}`}
          onOpenBot={openBot}
          onBotsChanged={refreshBots}
        />
      )}
      {view === 'editor' && currentBot && (
        <EditorView
          key={currentBot.id}
          bot={{ id: currentBot.id, name: currentBot.name, status: currentBot.status }}
          onBack={() => setView('dashboard')}
          onOpenInbox={() => setView('inbox')}
          onRenamed={(name, status) =>
            setCurrentBot((b) => (b ? { ...b, name, status } : b))
          }
        />
      )}
      {view === 'ai' && currentBot && (
        <AiAssistantView
          key={currentBot.id}
          bot={{ id: currentBot.id, name: currentBot.name, status: currentBot.status }}
          onBack={() => setView('dashboard')}
          onOpenInbox={() => setView('inbox')}
        />
      )}
      {view === 'channels' && currentBot && (
        <ChannelsView
          key={currentBot.id}
          bot={{ id: currentBot.id, name: currentBot.name, status: currentBot.status }}
          onBack={() => setView('dashboard')}
          onOpenEditor={() => setView('editor')}
        />
      )}
      {view === 'inbox' && currentBot && (
        <InboxView
          key={currentBot.id}
          bot={{ id: currentBot.id, name: currentBot.name }}
          onBack={() => setView('dashboard')}
          focusConversationId={chatFocus}
          onFocusConsumed={() => setChatFocus(null)}
        />
      )}
      {view === 'orders' && currentBot && (
        <OrdersView
          key={currentBot.id}
          bot={{ id: currentBot.id, name: currentBot.name }}
          onBack={() => setView('dashboard')}
          focusOrderId={orderFocus}
          onFocusConsumed={() => setOrderFocus(null)}
        />
      )}
      {(view !== 'dashboard' && !currentBot) && (
        <section className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bot className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="max-w-sm space-y-1">
            <h2 className="font-medium">Бот не выбран</h2>
            <p className="text-sm text-muted-foreground">
              Сначала выберите бота на дашборде — конструктор, каналы и остальные разделы работают с выбранным ботом.
            </p>
          </div>
          <Button onClick={() => setView('dashboard')}>
            <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
            Перейти к списку ботов
          </Button>
        </section>
      )}
    </Shell>
  );
}

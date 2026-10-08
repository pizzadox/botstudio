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
 * текущего бота, тумблер темы и выход. Список ботов грузится лениво — при
 * первом открытии.
 */
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

  useEffect(() => {
    if (!open || bots !== null) return;
    api<{ bots: BotListItem[] }>('/api/bots')
      .then((d) => setBots(d.bots))
      .catch(() => setBots([]));
  }, [open, bots]);

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

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const d = await api<NotificationsResponse>(
          `/api/notifications?since=${encodeURIComponent(sinceRef.current)}`
        );
        if (stopped) return;
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
        /* polling errors ignored */
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
    api<{ user: SessionUser }>('/api/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));

    // Если какой-то запрос вернул 401 (истёк токен и т.п.) — показываем вход
    const onUnauthorized = () => {
      setUser(null);
      setCurrentBot(null);
      setView('dashboard');
    };
    window.addEventListener('bstudio:unauthorized', onUnauthorized);
    return () => window.removeEventListener('bstudio:unauthorized', onUnauthorized);
  }, []);

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
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Bot className="h-7 w-7" aria-hidden="true" />
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

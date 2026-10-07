'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, LayoutDashboard, Loader2 } from 'lucide-react';
import { api, clearAuthToken } from '@/lib/client-api';
import type { SessionUser, BotListItem, ViewKey } from '@/lib/studio-types';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
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
    const t = setInterval(poll, 12000);
    return () => {
      stopped = true;
      clearInterval(t);
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
      onLogout={async () => {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        clearAuthToken();
        setUser(null);
        setCurrentBot(null);
        setView('dashboard');
      }}
    >
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
          bot={{ id: currentBot.id, name: currentBot.name, status: currentBot.status }}
          onBack={() => setView('dashboard')}
          onOpenInbox={() => setView('inbox')}
        />
      )}
      {view === 'channels' && currentBot && (
        <ChannelsView
          bot={{ id: currentBot.id, name: currentBot.name, status: currentBot.status }}
          onBack={() => setView('dashboard')}
          onOpenEditor={() => setView('editor')}
        />
      )}
      {view === 'inbox' && currentBot && (
        <InboxView
          bot={{ id: currentBot.id, name: currentBot.name }}
          onBack={() => setView('dashboard')}
          focusConversationId={chatFocus}
          onFocusConsumed={() => setChatFocus(null)}
        />
      )}
      {view === 'orders' && currentBot && (
        <OrdersView
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

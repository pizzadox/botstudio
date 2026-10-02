'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { api, clearAuthToken } from '@/lib/client-api';
import type { SessionUser, BotListItem, ViewKey } from '@/lib/studio-types';
import { useToast } from '@/hooks/use-toast';
import LoginView from './login-view';
import Shell from './shell';
import Dashboard from './dashboard';
import EditorView from './editor-view';
import AiAssistantView from './ai-assistant-view';
import ChannelsView from './channels-view';
import InboxView from './inbox-view';
import OrdersView from './orders-view';

interface NotificationsResponse {
  newOrders: { id: string; number: number; type: string; address: string | null; botName: string }[];
  newChats: { id: string; contact: string | null; source: string; botName: string }[];
  totals: { newOrders: number; openConvs: number };
}

/**
 * Фоновый наблюдатель: раз в 12 секунд спрашивает /api/notifications и
 * показывает тосты о новых заявках/диалогах + обновляет бейджи навигации.
 */
function NotificationsWatcher({
  onTotals,
}: {
  onTotals: (t: { newOrders: number; openConvs: number }) => void;
}) {
  const { toast } = useToast();
  const sinceRef = useRef<string>(new Date().toISOString());

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const d = await api<NotificationsResponse>(
          `/api/notifications?since=${encodeURIComponent(sinceRef.current)}`
        );
        if (stopped) return;
        sinceRef.current = new Date().toISOString();
        onTotals(d.totals);
        let shown = 0;
        for (const o of d.newOrders) {
          if (shown++ >= 3) break;
          toast({
            title: `🆕 Новая заявка №${o.number}`,
            description: `${o.botName}${o.address ? ` · ${o.address}` : ''}`,
          });
        }
        for (const c of d.newChats) {
          if (shown++ >= 3) break;
          toast({
            title: '💬 Новый диалог с клиентом',
            description: `${c.contact ?? 'Гость'} · ${c.botName}`,
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
  }, [onTotals, toast]);

  return null;
}

export default function AppRoot() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewKey>('dashboard');
  const [currentBot, setCurrentBot] = useState<BotListItem | null>(null);
  const [botsVersion, setBotsVersion] = useState(0);
  const [badges, setBadges] = useState({ newOrders: 0, openConvs: 0 });

  const refreshBots = useCallback(() => setBotsVersion((v) => v + 1), []);
  const onTotals = useCallback(
    (t: { newOrders: number; openConvs: number }) => setBadges(t),
    []
  );

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
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground animate-pulse">
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
      <NotificationsWatcher onTotals={onTotals} />
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
        />
      )}
      {view === 'orders' && currentBot && (
        <OrdersView
          bot={{ id: currentBot.id, name: currentBot.name }}
          onBack={() => setView('dashboard')}
        />
      )}
      {(view !== 'dashboard' && !currentBot) && (
        <div className="p-10 text-center text-muted-foreground">
          Сначала выберите бота на дашборде.
          <div className="mt-4">
            <button
              className="text-primary underline underline-offset-4"
              onClick={() => setView('dashboard')}
            >
              Перейти к списку ботов
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

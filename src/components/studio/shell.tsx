'use client';

import type { ReactNode } from 'react';
import {
  Bot,
  Inbox,
  LayoutDashboard,
  LogOut,
  Workflow,
  Plug,
} from 'lucide-react';
import type { SessionUser, ViewKey } from '@/lib/studio-types';
import { cn } from '@/lib/utils';

const NAV: { key: ViewKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { key: 'editor', label: 'Конструктор', icon: Workflow },
  { key: 'channels', label: 'Каналы', icon: Plug },
  { key: 'inbox', label: 'Входящие', icon: Inbox },
];

export default function Shell({
  user,
  view,
  onViewChange,
  currentBot,
  onLogout,
  children,
}: {
  user: SessionUser;
  view: ViewKey;
  onViewChange: (v: ViewKey) => void;
  currentBot: { id: string; name: string } | null;
  onLogout: () => void;
  children: ReactNode;
}) {
  return (
    <div className="h-dvh overflow-hidden flex flex-col bg-muted/40">
      {/* Мобильный хедер */}
      <header className="md:hidden flex items-center justify-between border-b bg-background px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bot className="h-4 w-4" />
          </div>
          <span className="font-bold">BotStudio</span>
        </div>
        <nav className="flex items-center gap-1">
          {NAV.map((n) => (
            <button
              key={n.key}
              aria-label={n.label}
              title={n.label}
              onClick={() => onViewChange(n.key)}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                view === n.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              <n.icon className="h-4 w-4" />
            </button>
          ))}
          <button
            aria-label="Выйти"
            title="Выйти"
            onClick={onLogout}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </nav>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Десктопный сайдбар */}
        <aside className="hidden md:flex h-full w-60 shrink-0 flex-col border-r bg-background">
          <div className="flex items-center gap-3 px-5 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-emerald-600/20">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="font-bold leading-tight">BotStudio</div>
              <div className="text-xs text-muted-foreground">визуальный конструктор</div>
            </div>
          </div>

          <nav className="flex-1 space-y-1 px-3">
            {NAV.map((n) => (
              <button
                key={n.key}
                onClick={() => onViewChange(n.key)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  view === n.key
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </button>
            ))}
          </nav>

          {currentBot && (
            <div className="mx-3 mb-3 rounded-xl border bg-muted/50 p-3">
              <div className="text-xs text-muted-foreground">Текущий бот</div>
              <div className="mt-0.5 truncate text-sm font-medium">{currentBot.name}</div>
            </div>
          )}

          <div className="border-t p-3">
            <div className="flex items-center gap-2 rounded-xl px-2 py-1.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold uppercase">
                {user.name?.[0] ?? user.username[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{user.name ?? user.username}</div>
                <div className="truncate text-xs text-muted-foreground">@{user.username}</div>
              </div>
              <button
                aria-label="Выйти"
                title="Выйти"
                onClick={onLogout}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 min-h-0 flex flex-col">{children}</main>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft,
  ClipboardList,
  ClipboardCheck,
  CircleCheck,
  CircleX,
  Loader2,
  MapPin,
  MessageSquare,
  Phone,
  PlayCircle,
  CalendarClock,
  Wrench,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import type { TicketDto } from '@/lib/studio-types';
import {
  SOURCE_COLORS,
  SOURCE_LABELS,
  TICKET_STATUS_COLORS,
  TICKET_STATUS_LABELS,
  TICKET_TYPE_LABELS,
} from '@/lib/studio-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import TicketDetailDialog from './ticket-detail-dialog';

type StatusFilter = '' | 'new' | 'in_progress' | 'done' | 'canceled';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: '', label: 'Все' },
  { key: 'new', label: 'Новые' },
  { key: 'in_progress', label: 'В работе' },
  { key: 'done', label: 'Выполнены' },
  { key: 'canceled', label: 'Отменены' },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TicketsView({
  bot,
  userName,
  onBack,
}: {
  bot: { id: string; name: string };
  userName: string;
  onBack: () => void;
  /** оставлено для совместимости вызова (app-root) */
  onOpenInbox?: () => void;
}) {
  const { toast } = useToast();
  const [tickets, setTickets] = useState<TicketDto[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<StatusFilter>('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<TicketDto | null>(null);

  const load = useCallback(async () => {
    try {
      const q = filter ? `?status=${filter}` : '';
      const d = await api<{ tickets: TicketDto[]; counts: Record<string, number> }>(
        `/api/bots/${bot.id}/tickets${q}`
      );
      setTickets(d.tickets);
      setCounts(d.counts ?? {});
    } catch {
      /* ignore polling errors */
    } finally {
      setLoading(false);
    }
  }, [bot.id, filter]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  const update = async (ticket: TicketDto, status: string) => {
    setBusyId(ticket.id);
    try {
      const d = await api<{ ticket: TicketDto }>(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, assignee: status === 'in_progress' ? userName : undefined }),
      });
      setTickets((prev) => prev.map((t) => (t.id === ticket.id ? { ...t, ...d.ticket } : t)));
      setSelected((prev) => (prev && prev.id === ticket.id ? { ...prev, ...d.ticket } : prev));
      toast({
        title: `Заявка №${ticket.number}`,
        description:
          status === 'in_progress'
            ? `Взята в работу (${userName})`
            : `Статус: ${TICKET_STATUS_LABELS[status] ?? status}`,
      });
    } catch {
      toast({ title: 'Не удалось обновить заявку', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const newCount = counts.new ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Шапка */}
      <div className="flex items-center gap-3 border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} aria-label="Назад">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold">Заявки</h1>
          <Badge variant="secondary">{bot.name}</Badge>
          {newCount > 0 && (
            <Badge className="animate-pulse bg-amber-500 text-white">{newCount} новых</Badge>
          )}
        </div>
      </div>

      {/* Фильтры */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b bg-background px-4 py-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              filter === f.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-muted'
            )}
          >
            {f.label}
            {f.key && (counts[f.key] ?? 0) > 0 && (
              <span className={cn('ml-1', filter === f.key ? 'opacity-80' : 'text-primary')}>
                {counts[f.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Список заявок */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <ClipboardCheck className="h-12 w-12 opacity-30" />
            <p className="max-w-xs text-sm">
              Заявок пока нет. Добавьте в сценарий блок «Заявка» — номер будет присваиваться
              автоматически и показываться клиенту.
            </p>
          </div>
        ) : (
          <div className="mx-auto grid max-w-5xl gap-3 lg:grid-cols-2">
            {tickets.map((t) => (
              <Card
                key={t.id}
                role="button"
                tabIndex={0}
                aria-label={`Заявка №${t.number} — открыть карточку с чатом`}
                onClick={() => setSelected(t)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(t);
                  }
                }}
                className={cn(
                  'cursor-pointer border transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  t.status === 'new' && 'border-amber-300/70'
                )}
              >
                <CardContent className="space-y-2.5 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-sm font-bold text-primary">
                      №{t.number}
                    </span>
                    <Badge variant="outline" className="bg-card">
                      {TICKET_TYPE_LABELS[t.type] ?? t.type}
                    </Badge>
                    <Badge className={cn('border-0', TICKET_STATUS_COLORS[t.status] ?? 'bg-muted')}>
                      {TICKET_STATUS_LABELS[t.status] ?? t.status}
                    </Badge>
                    <span className="ml-auto text-[11px] text-muted-foreground">{fmtDate(t.createdAt)}</span>
                  </div>

                  {t.subject && (
                    <p className="text-sm font-medium leading-snug">📝 {t.subject}</p>
                  )}

                  <div className="space-y-1 text-[13px] leading-snug text-muted-foreground">
                    {t.address && (
                      <div className="flex items-start gap-1.5">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t.address}
                      </div>
                    )}
                    {t.scheduledAt && (
                      <div className="flex items-start gap-1.5">
                        <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t.scheduledAt}
                      </div>
                    )}
                    {t.phone && (
                      <div className="flex items-start gap-1.5">
                        <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <a className="underline underline-offset-2" href={`tel:${t.phone.replace(/[^\d+]/g, '')}`}>
                          {t.phone}
                        </a>
                      </div>
                    )}
                    {t.details && (
                      <div className="flex items-start gap-1.5">
                        <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="line-clamp-3">{t.details}</span>
                      </div>
                    )}
                  </div>

                  <div
                    className="flex flex-wrap items-center gap-1.5 pt-0.5"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {t.status === 'new' && (
                      <Button
                        size="sm"
                        className="h-8"
                        disabled={busyId === t.id}
                        onClick={() => update(t, 'in_progress')}
                      >
                        <PlayCircle className="h-3.5 w-3.5" /> Взять в работу
                      </Button>
                    )}
                    {(t.status === 'new' || t.status === 'in_progress') && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          disabled={busyId === t.id}
                          onClick={() => update(t, 'done')}
                        >
                          <CircleCheck className="h-3.5 w-3.5" /> Выполнена
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-muted-foreground"
                          disabled={busyId === t.id}
                          onClick={() => update(t, 'canceled')}
                        >
                          <CircleX className="h-3.5 w-3.5" /> Отменить
                        </Button>
                      </>
                    )}
                    {t.assignee && (
                      <Badge variant="secondary" className="ml-auto">
                        👤 {t.assignee}
                      </Badge>
                    )}
                  </div>

                  {t.conversation && (
                    <div className="flex items-center gap-2 border-t pt-2 text-[11px] text-muted-foreground">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                          SOURCE_COLORS[t.conversation.source] ?? 'bg-muted'
                        )}
                      >
                        <MessageSquare className="mr-1 h-2.5 w-2.5" />
                        {SOURCE_LABELS[t.conversation.source] ?? t.conversation.source}
                      </span>
                      <span className="truncate">{t.conversation.contact || 'Гость'}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(t);
                        }}
                        className="ml-auto inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
                      >
                        <MessageSquare className="h-3 w-3" /> Чат с клиентом
                      </button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Карточка заявки со встроенным чатом с пользователем */}
      <TicketDetailDialog
        ticket={selected}
        open={selected !== null}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
        userName={userName}
        onUpdated={(t) => setTickets((prev) => prev.map((x) => (x.id === t.id ? t : x)))}
      />
    </div>
  );
}


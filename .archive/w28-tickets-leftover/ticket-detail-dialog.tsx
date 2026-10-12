'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  CalendarClock,
  CircleCheck,
  CircleX,
  Headset,
  Loader2,
  MapPin,
  MessageSquare,
  Phone,
  PlayCircle,
  Send,
  Wrench,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import type { ChatMessage, TicketDto } from '@/lib/studio-types';
import {
  SOURCE_COLORS,
  SOURCE_LABELS,
  TICKET_STATUS_COLORS,
  TICKET_STATUS_LABELS,
  TICKET_TYPE_LABELS,
} from '@/lib/studio-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Карточка заявки со ВСТРОЕННЫМ ЧАТОМ с пользователем.
 * Открывается по клику на карточку заявки в разделе «Заявки»:
 * оператор видит все данные заявки и переписку, может отвечать клиенту
 * прямо отсюда — ответ уходит в его мессенджер (MAX/Telegram/сайт).
 */
export default function TicketDetailDialog({
  ticket,
  open,
  onOpenChange,
  userName,
  onUpdated,
}: {
  ticket: TicketDto | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userName: string;
  onUpdated?: (t: TicketDto) => void;
}) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [convNeedsOperator, setConvNeedsOperator] = useState(false);
  const [convStatus, setConvStatus] = useState('open');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const conversationId = ticket?.conversationId ?? null;

  const loadChat = useCallback(async () => {
    if (!conversationId) return;
    try {
      const d = await api<{
        conversation: { needsOperator: boolean; status: string };
        messages: ChatMessage[];
      }>(`/api/conversations/${conversationId}`);
      setMessages(d.messages);
      setConvNeedsOperator(d.conversation.needsOperator);
      setConvStatus(d.conversation.status);
    } catch {
      /* ignore polling errors */
    }
  }, [conversationId]);

  useEffect(() => {
    if (!open || !conversationId) return;
    setMessages([]);
    loadChat();
    const t = setInterval(loadChat, 5000);
    return () => clearInterval(t);
  }, [open, conversationId, loadChat]);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, [messages, open]);

  if (!ticket) return null;

  const sendReply = async () => {
    const t = reply.trim();
    if (!t || !conversationId) return;
    setSending(true);
    setReply('');
    try {
      const d = await api<{ message: ChatMessage }>(`/api/conversations/${conversationId}/operator`, {
        method: 'POST',
        body: JSON.stringify({ text: t }),
      });
      setMessages((prev) => [...prev, d.message]);
    } catch {
      toast({ title: 'Не удалось отправить', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const update = async (status: string) => {
    setBusy(true);
    try {
      const d = await api<{ ticket: TicketDto }>(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          assignee: status === 'in_progress' ? userName : undefined,
        }),
      });
      onUpdated?.(d.ticket);
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
      setBusy(false);
    }
  };

  const isOpenTicket = ticket.status === 'new';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="space-y-1.5 border-b px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-base">
              Заявка №{ticket.number}
            </DialogTitle>
            <Badge variant="outline" className="bg-card">
              {TICKET_TYPE_LABELS[ticket.type] ?? ticket.type}
            </Badge>
            <Badge className={cn('border-0', TICKET_STATUS_COLORS[ticket.status] ?? 'bg-muted')}>
              {TICKET_STATUS_LABELS[ticket.status] ?? ticket.status}
            </Badge>
            <span className="ml-auto text-[11px] font-normal text-muted-foreground">
              {fmtDate(ticket.createdAt)}
            </span>
          </div>
          {ticket.conversation && (
            <DialogDescription className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  SOURCE_COLORS[ticket.conversation.source] ?? 'bg-muted'
                )}
              >
                <MessageSquare className="mr-1 h-2.5 w-2.5" />
                {SOURCE_LABELS[ticket.conversation.source] ?? ticket.conversation.source}
              </span>
              {ticket.conversation.contact || 'Гость'}
              {convNeedsOperator && convStatus === 'open' && (
                <Badge variant="destructive" className="animate-pulse px-1.5 py-0 text-[9px]">
                  <Headset className="mr-0.5 h-2.5 w-2.5" /> нужен оператор
                </Badge>
              )}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Данные заявки */}
          <div className="space-y-3 px-5 py-4">
            {isOpenTicket && (
              <div className="flex items-center gap-1.5 rounded-lg bg-amber-100 px-2.5 py-2 text-xs font-medium text-amber-900">
                <Headset className="h-3.5 w-3.5 shrink-0" />
                Нужно связаться с клиентом{ticket.phone ? ` по номеру ${ticket.phone}` : ''}
                {ticket.subject ? ` — по вопросу «${ticket.subject}»` : ''}
              </div>
            )}

            {ticket.subject && !isOpenTicket && (
              <p className="text-sm font-medium leading-snug">📝 {ticket.subject}</p>
            )}

            <div className="grid gap-1.5 text-[13px] leading-snug text-muted-foreground sm:grid-cols-2">
              {ticket.phone && (
                <div className="flex items-start gap-1.5">
                  <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <a
                    className="font-medium text-foreground underline underline-offset-2"
                    href={`tel:${ticket.phone.replace(/[^\d+]/g, '')}`}
                  >
                    {ticket.phone}
                  </a>
                </div>
              )}
              {ticket.address && (
                <div className="flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {ticket.address}
                </div>
              )}
              {ticket.scheduledAt && (
                <div className="flex items-start gap-1.5">
                  <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {ticket.scheduledAt}
                </div>
              )}
              {ticket.assignee && (
                <div className="flex items-center gap-1.5">
                  <Headset className="h-3.5 w-3.5 shrink-0" /> исполнитель: {ticket.assignee}
                </div>
              )}
            </div>

            {ticket.details && (
              <div className="flex items-start gap-1.5 text-[13px] leading-snug text-muted-foreground">
                <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{ticket.details}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {isOpenTicket && (
                <Button size="sm" className="h-8" disabled={busy} onClick={() => update('in_progress')}>
                  <PlayCircle className="h-3.5 w-3.5" /> Взять в работу
                </Button>
              )}
              {(ticket.status === 'new' || ticket.status === 'in_progress') && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={busy}
                    onClick={() => update('done')}
                  >
                    <CircleCheck className="h-3.5 w-3.5" /> Выполнена
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-muted-foreground"
                    disabled={busy}
                    onClick={() => update('canceled')}
                  >
                    <CircleX className="h-3.5 w-3.5" /> Отменить
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Встроенный чат с пользователем */}
          <div className="border-t bg-muted/30">
            <div className="flex items-center gap-2 px-5 pt-3 pb-1 text-xs font-semibold text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" /> Чат с клиентом
            </div>
            {conversationId ? (
              <>
                <div
                  ref={scrollRef}
                  className="max-h-72 space-y-2.5 overflow-y-auto px-5 py-3 md:max-h-96"
                >
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn('flex', m.role === 'user' ? 'justify-start' : 'justify-end')}
                    >
                      <div
                        className={cn(
                          'max-w-[85%] space-y-0.5 rounded-2xl px-3 py-2 text-sm leading-snug',
                          m.role === 'system'
                            ? 'w-full max-w-full bg-amber-50 text-center text-xs text-amber-900'
                            : m.role === 'user'
                              ? 'rounded-bl-md border bg-card'
                              : 'rounded-br-md bg-primary text-primary-foreground'
                        )}
                      >
                        {m.nodeId === '__operator' && m.role !== 'system' && (
                          <div className="flex items-center gap-1 text-[10px] opacity-70">
                            <Headset className="h-3 w-3" /> оператор
                          </div>
                        )}
                        <div className="whitespace-pre-wrap">{m.text}</div>
                        {m.role !== 'system' && (
                          <div className="text-right text-[9px] opacity-60">
                            {new Date(m.createdAt).toLocaleTimeString('ru-RU', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {messages.length === 0 && (
                    <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                      <Bot className="h-4 w-4" /> Сообщений пока нет
                    </div>
                  )}
                </div>

                <form
                  className="flex items-center gap-2 border-t bg-background px-5 py-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendReply();
                  }}
                >
                  <Input
                    placeholder="Ответить клиенту…"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <Button
                    type="submit"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    disabled={sending || !reply.trim()}
                    aria-label="Отправить"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </form>
              </>
            ) : (
              <div className="px-5 py-4 text-sm text-muted-foreground">
                Заявка создана без диалога (тестовый режим) — чат недоступен.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

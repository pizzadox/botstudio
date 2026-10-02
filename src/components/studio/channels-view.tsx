'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import {
  Bot,
  Check,
  ChevronLeft,
  Copy,
  Globe,
  Info,
  Loader2,
  MessageCircle,
  MessageSquare,
  Plug,
  Plus,
  Send,
  Trash2,
  Truck,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import type { ChannelItem } from '@/lib/studio-types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const CHANNEL_META: Record<
  ChannelItem['type'],
  { label: string; icon: typeof Send; color: string; hint: string; tokenLabel: string }
> = {
  telegram: {
    label: 'Telegram',
    icon: Send,
    color: 'bg-sky-100 text-sky-600',
    hint: '1. Откройте @BotFather → /newbot\n2. Скопируйте токен и вставьте здесь\n3. Скопируйте URL вебхука ниже — BotFather сам предложит его установить (или отправьте setWebhook вручную)',
    tokenLabel: 'Bot token (123456:ABC-DEF…)',
  },
  whatsapp: {
    label: 'WhatsApp',
    icon: MessageCircle,
    color: 'bg-emerald-100 text-emerald-600',
    hint: 'Подключение через WhatsApp Cloud API (Meta for Developers):\n1. Создайте приложение и добавьте продукт WhatsApp\n2. Вставьте Permanent Token в поле токена\n3. Укажите Phone Number ID в поле ниже\n4. Скопируйте URL вебхука в настройки WhatsApp → Callback URL',
    tokenLabel: 'Access Token (Meta)',
  },
  max: {
    label: 'MAX',
    icon: MessageSquare,
    color: 'bg-violet-100 text-violet-600',
    hint: 'Как получить токен:\n1. Откройте мессенджер MAX и найдите бота «MAX для бизнеса» (или откройте max.ru → Чат-боты)\n2. Создайте бота и скопируйте токен: раздел Чат-боты → выберите бота → ⋮ → Настройки → значок копирования\n3. Вставьте токен здесь и нажмите «Подключить»\n\nВебхук настраивать не нужно — студия сама принимает и отправляет сообщения в MAX.',
    tokenLabel: 'Bot token MAX',
  },
  web: {
    label: 'Чат для сайта',
    icon: Globe,
    color: 'bg-amber-100 text-amber-600',
    hint: 'Демо-чат не требует токенов. Скопируйте URL и обращайтесь к нему с сайта — или протестируйте бота прямо здесь, как это увидят посетители.',
    tokenLabel: 'Токен не требуется',
  },
};

export default function ChannelsView({
  bot,
  onBack,
  onOpenEditor,
}: {
  bot: { id: string; name: string; status: string };
  onBack: () => void;
  onOpenEditor: () => void;
}) {
  const { toast } = useToast();
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [type, setType] = useState<ChannelItem['type']>('telegram');
  const [title, setTitle] = useState('');
  const [token, setToken] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [demoChannel, setDemoChannel] = useState<ChannelItem | null>(null);
  const [origin, setOrigin] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api<{ channels: ChannelItem[] }>(`/api/bots/${bot.id}/channels`);
      setChannels(d.channels);
    } catch {
      toast({ title: 'Не удалось загрузить каналы', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [bot.id, toast]);

  useEffect(() => {
    setOrigin(window.location.origin);
    load();
  }, [load]);

  const createChannel = async () => {
    setBusy(true);
    try {
      await api(`/api/bots/${bot.id}/channels`, {
        method: 'POST',
        body: JSON.stringify({ type, title, token, phone }),
      });
      setAddOpen(false);
      setTitle('');
      setToken('');
      setPhone('');
      toast({ title: 'Канал добавлен' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (ch: ChannelItem, active: boolean) => {
    setChannels((cs) => cs.map((c) => (c.id === ch.id ? { ...c, active } : c)));
    try {
      await api(`/api/channels/${ch.id}`, { method: 'PUT', body: JSON.stringify({ active }) });
    } catch {
      load();
    }
  };

  const testChannel = async (ch: ChannelItem) => {
    toast({ title: 'Проверяем подключение…' });
    try {
      const d = await api<{ ok: boolean; message: string }>(`/api/channels/${ch.id}/test`, {
        method: 'POST',
      });
      toast({ title: d.message, variant: d.ok ? 'default' : 'destructive' });
      load();
    } catch {
      toast({ title: 'Ошибка проверки', variant: 'destructive' });
    }
  };

  const deleteChannel = async (ch: ChannelItem) => {
    try {
      await api(`/api/channels/${ch.id}`, { method: 'DELETE' });
      toast({ title: 'Канал удалён' });
      load();
    } catch {
      toast({ title: 'Не удалось удалить', variant: 'destructive' });
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Скопировано в буфер' });
    } catch {
      toast({ title: 'Не удалось скопировать', variant: 'destructive' });
    }
  };

  const webhookUrl = (ch: ChannelItem) => `${origin}/api/webhook/${ch.type}/${ch.secret}`;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} aria-label="Назад">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Plug className="h-6 w-6 text-primary" /> Каналы
            </h1>
            <p className="text-sm text-muted-foreground">Подключение бота «{bot.name}» к мессенджерам</p>
          </div>
        </div>
        <Button onClick={() => { setType('telegram'); setAddOpen(true); }}>
          <Plus className="h-4 w-4" /> Подключить канал
        </Button>
      </div>

      {bot.status !== 'published' && (
        <Alert className="border-amber-200 bg-amber-50">
          <Info className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-800">Бот ещё не опубликован</AlertTitle>
          <AlertDescription className="text-amber-700">
            Каналы сохранят настройки, но отвечать они начнут после публикации бота в{' '}
            <button className="font-medium underline underline-offset-2" onClick={onOpenEditor}>
              конструкторе
            </button>
            .
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Загрузка…
        </div>
      ) : channels.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Plug className="h-7 w-7" />
            </div>
            <div className="font-medium">Ни один канал не подключён</div>
            <p className="max-w-md text-sm text-muted-foreground">
              Подключите Telegram, WhatsApp, MAX — или создайте демо-чат, чтобы общаться с ботом
              прямо на сайте.
            </p>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Подключить канал
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((ch) => {
            const meta = CHANNEL_META[ch.type];
            const Icon = meta.icon;
            return (
              <Card key={ch.id}>
                <CardHeader className="pb-3">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', meta.color)}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">{ch.title}</CardTitle>
                        <CardDescription>{meta.label}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={ch.active}
                        onCheckedChange={(v) => toggleActive(ch, v)}
                        aria-label="Включить канал"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {ch.type === 'max' ? (
                    <div className="rounded-lg border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">Вебхук не нужен.</span> Сообщения из MAX
                      принимаются автоматически (long polling). Нажмите «Проверить» — студия свяжется с MAX и
                      покажет имя бота.
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
                      <code className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                        {webhookUrl(ch)}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => copy(webhookUrl(ch))}
                        aria-label="Скопировать URL вебхука"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                  {ch.type === 'web' && (
                    <Button variant="outline" className="w-full" onClick={() => setDemoChannel(ch)}>
                      <Bot className="h-4 w-4" /> Открыть демо-чат
                    </Button>
                  )}
                  {ch.lastStatus && (
                    <p className="text-xs text-muted-foreground">Статус: {ch.lastStatus}</p>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => testChannel(ch)}>
                      <Zap className="h-3.5 w-3.5" /> Проверить
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => deleteChannel(ch)}
                      aria-label="Удалить канал"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <details className="group">
                    <summary className="cursor-pointer text-xs font-medium text-primary">
                      Как подключить
                    </summary>
                    <p className="mt-2 whitespace-pre-line rounded-lg border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      {meta.hint}
                    </p>
                  </details>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Интеграция MyTKO (mytko.ru — «Чистая логистика») */}
      <MytkoCard botId={bot.id} />

      {/* Диалог добавления канала */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Подключить канал</DialogTitle>
            <DialogDescription>
              Выберите мессенджер и вставьте данные доступа.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(CHANNEL_META) as ChannelItem['type'][]).map((t) => {
                const meta = CHANNEL_META[t];
                const Icon = meta.icon;
                return (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition-all',
                      type === t
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'hover:border-primary/40'
                    )}
                  >
                    <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', meta.color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    {meta.label}
                  </button>
                );
              })}
            </div>
            <div className="space-y-2">
              <Label htmlFor="ch-title">Название канала</Label>
              <Input
                id="ch-title"
                placeholder={`${CHANNEL_META[type].label} — основной`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            {type !== 'web' && (
              <div className="space-y-2">
                <Label htmlFor="ch-token">{CHANNEL_META[type].tokenLabel}</Label>
                <Input
                  id="ch-token"
                  type="password"
                  placeholder="вставьте токен"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
            )}
            {type === 'whatsapp' && (
              <div className="space-y-2">
                <Label htmlFor="ch-phone">Phone Number ID</Label>
                <Input
                  id="ch-phone"
                  placeholder="например 123456789012345"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            )}
            <p className="whitespace-pre-line rounded-lg border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
              {CHANNEL_META[type].hint}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Отмена
            </Button>
            <Button onClick={createChannel} disabled={busy || (type !== 'web' && !token.trim())}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Подключить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Демо-чат */}
      <Dialog open={!!demoChannel} onOpenChange={(o) => !o && setDemoChannel(null)}>
        <DialogContent className="gap-0 p-0 sm:max-w-md">
          <VisuallyHidden>
            <DialogTitle>Демо-чат</DialogTitle>
            <DialogDescription>
              Проверьте, как бот общается с посетителями сайта
            </DialogDescription>
          </VisuallyHidden>
          {demoChannel && <DemoChat secret={demoChannel.secret} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Демо-виджет чата ────────────────────────────────────────────────────────

function DemoChat({ secret }: { secret: string }) {
  const [messages, setMessages] = useState<
    { id: string; role: string; text: string; buttons?: { id: string; text: string }[] }[]
  >([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const convRef = useRef<string | null>(null);
  const visitorRef = useRef<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const storageKey = `botstudio_demo_conv_${secret}`;
  const visitorKey = 'botstudio_visitor';

  // Стабильный id посетителя: один гость = одно обращение,
  // даже если conversationId был потерян
  useEffect(() => {
    try {
      let v = window.localStorage.getItem(visitorKey);
      if (!v) {
        v =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID().replace(/-/g, '')
            : Math.random().toString(36).slice(2) + Date.now().toString(36);
        window.localStorage.setItem(visitorKey, v);
      }
      visitorRef.current = v;
    } catch {
      visitorRef.current = Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }, [visitorKey]);

  // Восстановить диалог посетителя (как реальный виджет сайта)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        convRef.current = saved;
        fetch(`/api/webhook/demo/${secret}?conversationId=${saved}`)
          .then((r) => r.json())
          .then((d) => {
            if (d.messages?.length) setMessages(d.messages);
          })
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }, [secret, storageKey]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const poll = useCallback(async () => {
    if (!convRef.current) return;
    try {
      const d = await api<{
        messages: { id: string; role: string; text: string; buttons?: { id: string; text: string }[] }[];
      }>(`/api/webhook/demo/${secret}?conversationId=${convRef.current}`);
      setMessages((prev) => (d.messages.length > prev.length ? d.messages : prev));
    } catch {
      /* ignore */
    }
  }, [secret]);

  useEffect(() => {
    const t = setInterval(poll, 4000);
    return () => clearInterval(t);
  }, [poll]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setInput('');
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', text: t }]);
    scrollToBottom();
    try {
      const d = await api<{
        conversationId: string;
        messages: { id: string; role: string; text: string; buttons?: { id: string; text: string }[] }[];
      }>(`/api/webhook/demo/${secret}`, {
        method: 'POST',
        body: JSON.stringify({ text: t, conversationId: convRef.current, visitorId: visitorRef.current || undefined }),
      });
      convRef.current = d.conversationId;
      try {
        window.localStorage.setItem(storageKey, d.conversationId);
      } catch {
        /* ignore */
      }
      setMessages(d.messages);
      scrollToBottom();
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: 'bot', text: e instanceof Error ? e.message : 'Ошибка' },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 rounded-t-xl bg-gradient-to-r from-emerald-600 to-teal-600 p-4 text-white">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
          <Bot className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold leading-tight">Чат поддержки</div>
          <div className="flex items-center gap-1 text-xs text-white/80">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> онлайн
          </div>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          демо сайта
        </Badge>
      </div>
      <div ref={scrollRef} className="h-80 space-y-2.5 overflow-y-auto bg-muted/40 p-3">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            Напишите сообщение — бот ответит
            <br />
            как в настоящем виджете на сайте
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-snug',
                m.role === 'user'
                  ? 'rounded-br-md bg-primary text-primary-foreground'
                  : 'rounded-bl-md border bg-card'
              )}
            >
              {m.text}
            </div>
          </div>
        ))}
        {(() => {
          const lastButtons = [...messages].reverse().find((m) => m.role === 'bot' && m.buttons?.length)?.buttons;
          if (!lastButtons?.length) return null;
          return (
            <div className="flex flex-wrap gap-2 pt-1">
              {lastButtons.map((b) => (
                <button
                  key={b.id}
                  onClick={() => send(b.text)}
                  disabled={sending}
                  className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
                >
                  {b.text}
                </button>
              ))}
            </div>
          );
        })()}
      </div>
      <form
        className="flex items-center gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Input placeholder="Сообщение…" value={input} onChange={(e) => setInput(e.target.value)} />
        <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={sending || !input.trim()}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}

// ─── Интеграция MyTKO (mytko.ru «Чистая логистика») ──────────────────────────

interface MytkoReportItem {
  id: string;
  removalTs: string | null;
  vehicleNumber: string | null;
  lkCode: string | null;
  factContainersAmount: number | null;
  pickedUpVolume: number | null;
  notRemoved: number;
}

function MytkoCard({ botId }: { botId: string }) {
  const { toast } = useToast();
  const [cfg, setCfg] = useState({
    enabled: false,
    apiUrl: '',
    username: '',
    lkCodes: '',
    hasPassword: false,
  });
  const [password, setPassword] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<'test' | 'reports' | 'save' | null>(null);
  const [reports, setReports] = useState<MytkoReportItem[] | null>(null);

  useEffect(() => {
    api<{ config: typeof cfg }>(`/api/bots/${botId}/mytko`)
      .then((d) => setCfg(d.config))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [botId]);

  const save = async (patch?: Record<string, unknown>) => {
    setBusy('save');
    try {
      await api(`/api/bots/${botId}/mytko`, {
        method: 'POST',
        body: JSON.stringify({ action: 'save', ...patch }),
      });
      return true;
    } catch {
      toast({ title: 'Не удалось сохранить настройки', variant: 'destructive' });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const d = await api<{ ok: boolean; error?: string }>(`/api/bots/${botId}/mytko`, {
        method: 'POST',
        body: JSON.stringify({ action: 'test' }),
      });
      toast({
        title: d.ok ? 'Подключение к MyTKO установлено ✅' : `Ошибка: ${d.error ?? 'unknown'}`,
        variant: d.ok ? 'default' : 'destructive',
      });
    } catch (e) {
      toast({ title: 'Ошибка проверки', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const loadReports = async () => {
    setBusy('reports');
    try {
      const d = await api<{ ok: boolean; reports?: MytkoReportItem[]; error?: string }>(
        `/api/bots/${botId}/mytko`,
        { method: 'POST', body: JSON.stringify({ action: 'reports' }) }
      );
      if (d.ok && d.reports) {
        setReports(d.reports);
        toast({ title: `Загружено отчётов: ${d.reports.length}` });
      } else {
        toast({ title: `Ошибка: ${d.error ?? 'unknown'}`, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Не удалось загрузить отчёты', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (!loaded) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <Truck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base">Интеграция MyTKO</CardTitle>
              <CardDescription className="truncate">
                mytko.ru «Чистая логистика»: факты вывоза и машины-водители
              </CardDescription>
            </div>
          </div>
          <Switch
            checked={cfg.enabled}
            onCheckedChange={(v) => {
              setCfg((c) => ({ ...c, enabled: v }));
              save({ enabled: v });
            }}
            aria-label="Включить интеграцию MyTKO"
          />
        </div>
      </CardHeader>
      {cfg.enabled && (
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">API-адрес</Label>
              <Input
                value={cfg.apiUrl}
                placeholder="https://disp.t2.groupstp.ru"
                onChange={(e) => setCfg((c) => ({ ...c, apiUrl: e.target.value }))}
                onBlur={() => save({ apiUrl: cfg.apiUrl })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Логин</Label>
              <Input
                value={cfg.username}
                placeholder="выдаёт поддержка mytko@groupstp.ru"
                onChange={(e) => setCfg((c) => ({ ...c, username: e.target.value }))}
                onBlur={() => save({ username: cfg.username })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Пароль {cfg.hasPassword && <span className="text-emerald-600">••• сохранён</span>}
              </Label>
              <Input
                type="password"
                value={password}
                placeholder={cfg.hasPassword ? 'введите новый, чтобы заменить' : 'пароль MyTKO'}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => {
                  if (password.trim()) {
                    save({ password: password.trim() });
                    setPassword('');
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Коды КП (через запятую)</Label>
              <Input
                value={cfg.lkCodes}
                placeholder="38012345, 38105858"
                onChange={(e) => setCfg((c) => ({ ...c, lkCodes: e.target.value }))}
                onBlur={() => save({ lkCodes: cfg.lkCodes })}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={test} disabled={busy !== null}>
              {busy === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Проверить подключение
            </Button>
            <Button size="sm" variant="outline" onClick={loadReports} disabled={busy !== null}>
              {busy === 'reports' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Truck className="h-3.5 w-3.5" />
              )}
              Отчёты водителей
            </Button>
          </div>
          {reports && (
            <div className="max-h-64 overflow-y-auto rounded-lg border">
              {reports.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">
                  Отчётов за последние 7 дней по указанным КП нет.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/70 text-left text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Дата вывоза</th>
                      <th className="px-2 py-1.5 font-medium">КП</th>
                      <th className="px-2 py-1.5 font-medium">Машина</th>
                      <th className="px-2 py-1.5 font-medium">Факт</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="whitespace-nowrap px-2 py-1.5">
                          {r.removalTs
                            ? new Date(r.removalTs).toLocaleString('ru-RU', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </td>
                        <td className="px-2 py-1.5">{r.lkCode ?? '—'}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-medium">{r.vehicleNumber ?? '—'}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          {r.factContainersAmount ?? '—'}
                          {r.notRemoved > 0 && (
                            <span className="ml-1 text-destructive">(-{r.notRemoved})</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          <details>
            <summary className="cursor-pointer text-xs font-medium text-primary">Как работает интеграция</summary>
            <p className="mt-2 rounded-lg border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
              Доступы выдаёт техподдержка MyTKO (mytko@groupstp.ru). Отчёты водителей
              (машина, время, факт вывоза по КП) студия получает по REST —
              кнопка «Отчёты водителей». Передача заявок в MyTKO — через очередь
              Kafka (топик EXTERNAL_SYNC_DSP_IMPORT), доступ к брокеру выдаётся
              под конкретную интеграцию; контракт сообщения уже подготовлен в коде.
            </p>
          </details>
        </CardContent>
      )}
    </Card>
  );
}

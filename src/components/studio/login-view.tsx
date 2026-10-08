'use client';

import { useState } from 'react';
import { Bot, Eye, EyeOff, Headset, Loader2, LockKeyhole, MessageSquareText, Sparkles, Workflow } from 'lucide-react';
import { api, setAuthToken } from '@/lib/client-api';
import type { SessionUser } from '@/lib/studio-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const FEATURES = [
  {
    icon: Workflow,
    title: 'Визуальный конструктор',
    text: 'Собирайте алгоритмы из блоков мышью — без кода',
  },
  {
    icon: Sparkles,
    title: 'ИИ-ответы с памятью',
    text: 'Нейросеть отвечает на вопросы по вашей базе знаний',
  },
  {
    icon: MessageSquareText,
    title: 'Все мессенджеры',
    text: 'Telegram, WhatsApp, MAX и чат для сайта — в одном окне',
  },
  {
    icon: Headset,
    title: 'Передача оператору',
    text: 'Сложные диалоги попадают в инбокс живой поддержки',
  },
];

export default function LoginView({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // IMP-FE21-11: «показать пароль» — с клавиатурным доступом (aria-pressed, focus-ring)
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (mode: 'login' | 'register') => {
    setError(null);
    setBusy(true);
    try {
      const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload = mode === 'login' ? { username: login, password } : { username: login, password, name };
      const d = await api<{ user: SessionUser; token?: string }>(url, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (d.token) setAuthToken(d.token);
      onLogin(d.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Что-то пошло не так');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50 via-background to-teal-50 dark:from-emerald-950/40 dark:via-background dark:to-teal-950/40">
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-4xl grid lg:grid-cols-2 gap-8 items-center">
          {/* Брендовая часть */}
          <div className="hidden lg:block space-y-8">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-emerald-600/20">
                <Bot className="h-6 w-6" />
              </div>
              <div>
                <div className="text-2xl font-bold tracking-tight">BotStudio</div>
                <div className="text-sm text-muted-foreground">конструктор ботов техподдержки</div>
              </div>
            </div>
            <h1 className="text-3xl font-bold leading-snug">
              Создавайте ботов для поддержки
              <br />
              <span className="text-primary">без единой строчки кода</span>
            </h1>
            <ul className="space-y-4">
              {FEATURES.map((f) => (
                <li key={f.title} className="flex gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <f.icon className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">{f.title}</div>
                    <div className="text-sm text-muted-foreground">{f.text}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Форма */}
          <div className="w-full max-w-md mx-auto">
            <div className="lg:hidden mb-6 flex items-center justify-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Bot className="h-5 w-5" />
              </div>
              <div className="text-xl font-bold tracking-tight">BotStudio</div>
            </div>
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              {/* IMP-FE21-11: при смене вкладки сбрасываем ошибку и видимость пароля */}
              <Tabs
                defaultValue="login"
                onValueChange={() => {
                  setError(null);
                  setShowPassword(false);
                }}
              >
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="login">Вход</TabsTrigger>
                  <TabsTrigger value="register">Регистрация</TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="space-y-4">
                  <form
                    className="space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submit('login');
                    }}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="login-username">Логин</Label>
                      <Input
                        id="login-username"
                        autoFocus
                        placeholder="ваш_логин"
                        autoComplete="username"
                        aria-describedby="login-username-hint"
                        value={login}
                        onChange={(e) => setLogin(e.target.value)}
                        disabled={busy}
                        required
                      />
                      <p id="login-username-hint" className="text-xs text-muted-foreground">
                        Логин, который вы указали при регистрации
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password">Пароль</Label>
                      <div className="relative">
                        <Input
                          id="login-password"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          autoComplete="current-password"
                          aria-describedby="login-password-hint"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          disabled={busy}
                          required
                          className="pr-9"
                        />
                        <button
                          type="button"
                          aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                          aria-pressed={showPassword}
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                      <p id="login-password-hint" className="text-xs text-muted-foreground">
                        Пароль от вашей учётной записи
                      </p>
                    </div>
                    {error && (
                      <p
                        role="alert"
                        aria-live="assertive"
                        className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                      >
                        {error}
                      </p>
                    )}
                    <Button type="submit" className="w-full" disabled={busy}>
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                      )}
                      {busy ? 'Вхожу…' : 'Войти в студию'}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="register" className="space-y-4">
                  <form
                    className="space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submit('register');
                    }}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="reg-name">Имя (необязательно)</Label>
                      <Input
                        id="reg-name"
                        autoFocus
                        placeholder="Как к вам обращаться"
                        aria-describedby="reg-name-hint"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={busy}
                      />
                      <p id="reg-name-hint" className="text-xs text-muted-foreground">
                        Его увидят клиенты в чате
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-username">Логин</Label>
                      <Input
                        id="reg-username"
                        placeholder="латиница и цифры"
                        autoComplete="username"
                        aria-describedby="reg-username-hint"
                        value={login}
                        onChange={(e) => setLogin(e.target.value)}
                        disabled={busy}
                        required
                      />
                      <p id="reg-username-hint" className="text-xs text-muted-foreground">
                        Латиница и цифры, без пробелов
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-password">Пароль</Label>
                      <div className="relative">
                        <Input
                          id="reg-password"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="минимум 6 символов"
                          autoComplete="new-password"
                          aria-describedby="reg-password-hint"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          disabled={busy}
                          required
                          // IMP-FE21-11: клиентская валидация до запроса —
                          // согласована с подсказкой (латиница/цифры/знаки, без пробелов и кириллицы)
                          minLength={6}
                          pattern="[!-~]+"
                          title="От 6 символов — латиница, цифры и знаки (без пробелов и кириллицы)"
                          className="pr-9"
                        />
                        <button
                          type="button"
                          aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                          aria-pressed={showPassword}
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                      <p id="reg-password-hint" className="text-xs text-muted-foreground">
                        От 6 символов — латиница, цифры, знаки (без пробелов и кириллицы)
                      </p>
                    </div>
                    {error && (
                      <p
                        role="alert"
                        aria-live="assertive"
                        className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                      >
                        {error}
                      </p>
                    )}
                    <Button type="submit" className="w-full" disabled={busy}>
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Bot className="h-4 w-4" aria-hidden="true" />
                      )}
                      {busy ? 'Создаю…' : 'Создать аккаунт'}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Один аккаунт — сколько угодно ботов для всех мессенджеров
            </p>
          </div>
        </div>
      </main>
      <footer className="mt-auto py-4 text-center text-xs text-muted-foreground border-t bg-background/60">
        BotStudio · визуальный редактор ботов для MAX, Telegram, WhatsApp и других мессенджеров
      </footer>
    </div>
  );
}

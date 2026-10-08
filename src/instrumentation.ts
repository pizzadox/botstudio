/**
 * Next.js instrumentation hook — выполняется один раз при старте сервера.
 * Здесь запускаем фоновые воркеры (например, приёмщик сообщений MAX)
 * и периодические задачи обслуживания БД.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Защита от двойной регистрации (dev-хотрелоад может вызвать register повторно)
  const g = globalThis as unknown as { __botStudioWorkersStarted?: boolean };
  if (g.__botStudioWorkersStarted) return;
  g.__botStudioWorkersStarted = true;

  const { startMaxPoller } = await import('./lib/max-poller');
  startMaxPoller();

  // Периодическая чистка протухших сессий — раз в час.
  // (Сессии удаляются лениво при проверке авторизации, но мёртвые сессии
  // «повисают» в БД навсегда, если пользователь больше не заходит.)
  const { db } = await import('./lib/db');
  const cleanupSessions = (): void => {
    void db.session
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .then((r) => {
        if (r.count > 0) console.log(`[instrumentation] удалено протухших сессий: ${r.count}`);
      })
      .catch(() => {
        // таблица может ещё не существовать при первом db:push — не критично
      });
  };
  cleanupSessions();
  const timer = setInterval(cleanupSessions, 60 * 60 * 1000);
  // не удерживаем процесс из-за таймера
  if (typeof timer.unref === 'function') timer.unref();

  // 22-BE2 (IMP-BE22): часовая чистка «мусорных» веб-диалогов — source='web',
  // без единого сообщения, старше 7 дней (виджет открыли и не написали /
  // диалог создался впустую). Каскад удалит нечего — сообщений нет, заявок нет.
  const cleanupEmptyWebConversations = (): void => {
    void db.conversation
      .deleteMany({
        where: {
          source: 'web',
          createdAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
          messages: { none: {} },
        },
      })
      .then((r) => {
        if (r.count > 0) console.log(`[instrumentation] удалено пустых web-диалогов: ${r.count}`);
      })
      .catch(() => {
        // таблица может ещё не существовать при первом db:push — не критично
      });
  };
  cleanupEmptyWebConversations();
  const cleanupTimer = setInterval(cleanupEmptyWebConversations, 60 * 60 * 1000);
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
}

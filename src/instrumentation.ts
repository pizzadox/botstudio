/**
 * Next.js instrumentation hook — выполняется один раз при старте сервера.
 * Здесь запускаем фоновые воркеры (например, приёмщик сообщений MAX).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startMaxPoller } = await import('./lib/max-poller');
    startMaxPoller();
  }
}

'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Error boundary маршрута (App Router): ловит любые runtime-ошибки рендера
 * вместо белого экрана. «Попробовать снова» — reset() (повторный рендер
 * сегмента), «На дашборд» — полная перезагрузка приложения.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // В консоль/телематрию — полный стек, пользователю покажем только суть
    console.error(error);
  }, [error]);

  const message = (error?.message || 'Неизвестная ошибка').slice(0, 200);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <div
        role="alert"
        className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-lg font-bold tracking-tight">Что-то сломалось</h1>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {message}
          {error?.digest ? (
            <span className="mt-1 block font-mono text-[11px] text-muted-foreground/70">
              digest: {error.digest}
            </span>
          ) : null}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={reset}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Попробовать снова
          </Button>
          <Button variant="outline" onClick={() => (window.location.href = '/')}>
            На дашборд
          </Button>
        </div>
      </div>
    </div>
  );
}

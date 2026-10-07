'use client';

import { Badge } from '@/components/ui/badge';
import { MYTKO_BADGES, mytkoBadgeKey } from '@/lib/studio-types';
import { cn } from '@/lib/utils';

/**
 * Dark-пары к light-классам из MYTKO_BADGES (studio-types.ts):
 * те же цвета в формате /15 + text-*-300 + border-*-500/30 для тёмной темы.
 */
const DARK_CLS: Record<'synced' | 'error' | 'none', string> = {
  synced: 'dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  error: 'dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
  none: 'dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30',
};

/**
 * Бейдж синхронизации заявки с MyTKO «Чистая логистика».
 * Показывается везде, где видна заявка (список, карта, карточка, инбокс),
 * когда интеграция включена в разделе «Каналы».
 */
export function MytkoBadge({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const key = mytkoBadgeKey(status);
  const badge = MYTKO_BADGES[key];
  return (
    <Badge
      variant="outline"
      title={badge.title}
      className={cn('h-4 shrink-0 px-1 text-[9px]', badge.cls, DARK_CLS[key], className)}
    >
      {badge.label}
    </Badge>
  );
}

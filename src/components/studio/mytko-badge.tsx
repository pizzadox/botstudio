'use client';

import { Badge } from '@/components/ui/badge';
import { MYTKO_BADGES, mytkoBadgeKey } from '@/lib/studio-types';
import { cn } from '@/lib/utils';

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
  const badge = MYTKO_BADGES[mytkoBadgeKey(status)];
  return (
    <Badge
      variant="outline"
      title={badge.title}
      className={cn('h-4 shrink-0 px-1 text-[9px]', badge.cls, className)}
    >
      {badge.label}
    </Badge>
  );
}

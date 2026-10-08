/**
 * Простые in-memory счётчики метрик (22-BE2, IMP-BE22-08).
 * Хранятся на globalThis — переживают HMR в dev. Без внешних зависимостей.
 *
 * Подключение:
 *   import { inc, snapshot } from '@/lib/metrics';
 *   inc('rateLimited');            // событие
 *   const m = snapshot();          // снимок для /api/health
 *
 * Счётчики:
 *   inbound, inboundErrors, aiTimeouts, deliveries, deliveryFailures, rateLimited.
 *
 * Примечание для интегратора: inbound/inboundErrors/aiTimeouts/deliveries/
 * deliveryFailures должны инкрементироваться в src/lib/webhook.ts / flow-engine.ts /
 * deliver.ts (зоны других агентов волны 22) — точки подключения согласованы,
 * достаточно добавить inc('...') в соответствующие ветки.
 */

export type MetricKey =
  | 'inbound'
  | 'inboundErrors'
  | 'aiTimeouts'
  | 'deliveries'
  | 'deliveryFailures'
  | 'rateLimited';

const KEYS: readonly MetricKey[] = [
  'inbound',
  'inboundErrors',
  'aiTimeouts',
  'deliveries',
  'deliveryFailures',
  'rateLimited',
];

type MetricsState = Record<MetricKey, number> & { startedAt: number };

const store: MetricsState =
  ((globalThis as Record<string, unknown>).__bstudioMetrics as MetricsState | undefined) ??
  (() => {
    const initial = { startedAt: Date.now() } as MetricsState;
    for (const k of KEYS) initial[k] = 0;
    return initial;
  })();
(globalThis as Record<string, unknown>).__bstudioMetrics = store;

/** Инкрементировать счётчик на 1 (неизвестные ключи игнорируются) */
export function inc(key: MetricKey): void {
  if (key in store) store[key] += 1;
}

/** Снимок счётчиков (копия — вызывающий не может мутировать состояние) */
export function snapshot(): Record<MetricKey, number> {
  const out = {} as Record<MetricKey, number>;
  for (const k of KEYS) out[k] = store[k];
  return out;
}

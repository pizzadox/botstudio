/**
 * Матрица переходов статусов заявки (22-BE2, IMP-BE22-09).
 *
 * Реальные статусы из кода (ORDER_STATUS_LABELS в orders.ts / studio-types.ts,
 * Select в orders-view.tsx): new, assigned, in_progress, completed, cancelled.
 * Фронтовые вкладки: ACTIVE = [new, assigned, in_progress], ARCHIVE = [completed, cancelled].
 *
 * Правила:
 *  - Основной путь: new → assigned → in_progress → completed.
 *  - Активная заявка может быть отменена: new/assigned/in_progress → cancelled.
 *  - Операторский UI (Select со всеми статусами) разрешает и «влево» между
 *    активными статусами (assigned → new и т.п.) — это допустимо, заявка ещё живая.
 *  - ИЗ ФИНАЛЬНЫХ (completed, cancelled) переход запрещён без force —
 *    переоткрытие только осознанно (PATCH ?force=1 / body.force; bulk body.force).
 *  - completedAt ставится ТОЛЬКО при переходе в completed и никогда не сбрасывается
 *    (раньше PATCH затирал его null'ом при любом уходе из финального статуса).
 */

export const ORDER_STATUSES = ['new', 'assigned', 'in_progress', 'completed', 'cancelled'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FINAL_ORDER_STATUSES: readonly OrderStatus[] = ['completed', 'cancelled'];

/** Разрешённые переходы (из → в). */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ['assigned', 'in_progress', 'completed', 'cancelled'],
  assigned: ['new', 'in_progress', 'completed', 'cancelled'],
  in_progress: ['new', 'assigned', 'completed', 'cancelled'],
  // Финальные: переоткрытие только через force (проверяется отдельно)
  completed: [],
  cancelled: [],
};

export interface TransitionCheck {
  ok: boolean;
  /** Человекочитаемая причина отказа (для 400) */
  error?: string;
  /** Требуется force (переход из финального статуса) */
  needForce?: boolean;
}

/**
 * Проверить переход. Совпадение статуса с текущим — no-op (ok, force не нужен):
 * оператор мог пересохранить карточку с тем же статусом.
 */
export function checkStatusTransition(from: string, to: string, force: boolean): TransitionCheck {
  if (from === to) return { ok: true };
  if (!(ORDER_STATUSES as readonly string[]).includes(to)) {
    return { ok: false, error: 'Неизвестный статус' };
  }
  if ((FINAL_ORDER_STATUSES as readonly string[]).includes(from)) {
    if (!force) return { ok: false, error: 'Заявка уже закрыта', needForce: true };
    return { ok: true };
  }
  const allowed = ORDER_STATUS_TRANSITIONS[from as OrderStatus];
  if (!allowed || !allowed.includes(to as OrderStatus)) {
    return { ok: false, error: `Недопустимый переход статуса: ${from} → ${to}` };
  }
  return { ok: true };
}

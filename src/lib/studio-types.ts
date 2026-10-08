// Общие клиентские типы студии

export interface SessionUser {
  id: string;
  username: string;
  name: string | null;
}

export interface BotListItem {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  /// Состояние интеграции MyTKO (для бейджа на карточке бота); null — интеграция не настроена
  mytko?: { enabled: boolean; hasToken: boolean } | null;
  channelsCount: number;
  conversationsCount: number;
  ordersCount?: number;
  channelTypes: string[];
  /// lastStatus каналов для бейджа «канал ОК/ошибка» (заполняется с волны 22)
  channelStatuses?: { type: string; lastStatus: string | null }[];
}

export interface Stats {
  bots: number;
  conversations: number;
  messages: number;
  needsOperator: number;
  activeChannels: number;
}

export interface BotDetail {
  id: string;
  name: string;
  description: string | null;
  status: string;
  flow: string;
}

export interface ChannelItem {
  id: string;
  botId: string;
  type: 'telegram' | 'whatsapp' | 'max' | 'web';
  title: string;
  /** @deprecated с волны 21 сервер отдаёт только tokenMasked — поле не заполняется */
  token?: string | null;
  /** Маскированный токен для отображения (например «demo…x9A») */
  tokenMasked?: string | null;
  /** Есть ли сохранённый токен (реальное значение не покидает сервер) */
  hasToken?: boolean;
  phone: string | null;
  secret: string;
  /** Готовый URL вебхука (собирается на сервере из secret) */
  webhookUrl?: string;
  active: boolean;
  lastStatus: string | null;
  createdAt: string;
}

export interface ConversationListItem {
  id: string;
  source: string;
  contact: string | null;
  externalId: string | null;
  needsOperator: boolean;
  status: string;
  /** Есть непрочитанное сообщение от клиента (для бейджа «новое») */
  unread: boolean;
  messagesCount: number;
  updatedAt: string;
  lastMessage: { role: string; text: string; createdAt: string } | null;
}

export interface ChatMessage {
  id: string;
  role: string;
  text: string;
  nodeId?: string | null;
  createdAt: string;
}

// IMP-23-TAB-01: вкладки «Обращения» и «Реестр КП» (волна 23)
export type ViewKey =
  | 'dashboard'
  | 'editor'
  | 'ai'
  | 'channels'
  | 'inbox'
  | 'orders'
  | 'complaints'
  | 'areas';

/** Ответ /api/notifications (фоновый поллинг в app-root) */
export interface NotificationDto {
  /** Серверное время ответа — курсор следующего опроса (не часы браузера!) */
  now: string;
  newOrders: {
    id: string;
    number: number;
    type: string;
    address: string | null;
    botId: string;
    botName: string;
  }[];
  newChats: {
    id: string;
    contact: string | null;
    source: string;
    botId: string;
    botName: string;
  }[];
  totals: { newOrders: number; openConvs: number };
  /** IMP-23-TAB-01: новые жалобы для бейджа вкладки «Обращения» (с волны 23) */
  complaints?: number;
}

export interface AiConfig {
  enabled: boolean;
  prompt: string;
  reaskMenu: boolean;
}

export interface KnowledgeItemDto {
  id: string;
  botId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Заявки (вывоз отходов / КГМ) ──────────────────────────────────────────

export interface OrderDto {
  id: string;
  botId: string;
  conversationId: string | null;
  externalUserId: string | null;
  number: number;
  type: string;
  clientName: string | null;
  /** Город обслуживания (выбор города в боте / у оператора) */
  city: string | null;
  phone: string | null;
  address: string | null;
  size: string | null;
  wishDate: string | null;
  comment: string | null;
  status: string;
  assignee: string | null;
  lat: number | null;
  lng: number | null;
  /** Как получены координаты: manual — указаны оператором, geocode — по адресу */
  geoSource: 'manual' | 'geocode' | null;
  /** Синхронизация с MyTKO: synced — сверено, error — ошибка, null — ещё не синхронизировалось */
  mytkoStatus: 'synced' | 'error' | null;
  mytkoSyncAt: string | null;
  /** Сводка из MyTKO (машина/факт вывоза или пояснение) */
  mytkoInfo: string | null;
  mytkoError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  conversation?: {
    contact: string | null;
    source: string;
    externalUserId: string | null;
    needsOperator?: boolean;
  } | null;
  messagesCount?: number;
}

export interface OrderMessageDto {
  id: string;
  role: string;
  text: string;
  nodeId?: string | null;
  orderId?: string | null;
  createdAt: string;
}

/** Метки синхронизации с MyTKO (везде, где видна заявка) */
export const MYTKO_BADGES: Record<string, { label: string; cls: string; title: string }> = {
  synced: {
    label: 'MyTKO ✓',
    cls: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    title: 'Синхронизировано с MyTKO (Чистая логистика)',
  },
  error: {
    label: 'MyTKO !',
    cls: 'bg-rose-100 text-rose-800 border-rose-200',
    title: 'Ошибка синхронизации с MyTKO — нажмите «Синхронизировать» в карточке заявки',
  },
  none: {
    label: 'MyTKO —',
    cls: 'bg-slate-100 text-slate-500 border-slate-200',
    title: 'Не синхронизировано с MyTKO',
  },
};

export function mytkoBadgeKey(status: string | null | undefined): 'synced' | 'error' | 'none' {
  if (status === 'synced' || status === 'error') return status;
  return 'none';
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  assigned: 'Назначена',
  in_progress: 'В работе',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

export const ORDER_STATUS_BADGES: Record<string, string> = {
  new: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  assigned: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
  in_progress: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30',
  completed: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  cancelled: 'bg-slate-200 text-slate-600 border-slate-300 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30',
};

export const ORDER_TYPE_LABELS: Record<string, string> = {
  waste: 'Вывоз отходов',
  kgm: 'Вывоз КГМ',
  other: 'Другое',
};

export const ORDER_TYPE_ICONS: Record<string, string> = {
  waste: '🚛',
  kgm: '📦',
  other: '📋',
};

export const SOURCE_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  max: 'MAX',
  web: 'Сайт',
  simulator: 'Симулятор',
};

export const SOURCE_COLORS: Record<string, string> = {
  telegram: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  whatsapp: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  max: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  web: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  simulator: 'bg-slate-200 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
};

// ─── Обращения (жалобы клиентов) — волна 23 ────────────────────────────────

export interface ComplaintDto {
  id: string;
  number: number;
  type: string;
  status: string;
  description: string;
  /** Когда произошёл инцидент (указал клиент/оператор); null — не указано */
  happenedAt: string | null;
  contact: string | null;
  /** scenario — собрала ветка жалоб в боте, manual — оператор добавил вручную */
  source: 'scenario' | 'manual';
  createdAt: string;
  /** Диалог, из которого пришла жалоба (для кнопки «Открыть диалог») */
  conversationId: string | null;
}

export interface ComplaintCounts {
  total: number;
  new: number;
  inReview: number;
  resolved: number;
}

export const COMPLAINT_TYPE_LABELS: Record<string, string> = {
  no_pickup: 'Не вывезли',
  damaged: 'Повреждён контейнер',
  overflow: 'Площадка переполнена',
  other: 'Другое',
};

export const COMPLAINT_STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  in_review: 'В работе',
  resolved: 'Решена',
};

export const COMPLAINT_SOURCE_LABELS: Record<string, string> = {
  scenario: 'Из бота',
  manual: 'Вручную',
};

/** Цвета бейджей статуса — по образцу ORDER_STATUS_BADGES */
export const COMPLAINT_STATUS_BADGES: Record<string, string> = {
  new: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  in_review: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
  resolved:
    'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
};

/** Цвета бейджей источника — по образцу SOURCE_COLORS */
export const COMPLAINT_SOURCE_BADGES: Record<string, string> = {
  scenario: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  manual: 'bg-slate-200 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
};

/** Ключ в ComplaintCounts для статуса жалобы (status 'in_review' → counts.inReview) */
export function complaintCountKey(status: string): Exclude<keyof ComplaintCounts, 'total'> {
  if (status === 'resolved') return 'resolved';
  if (status === 'in_review') return 'inReview';
  return 'new';
}

// ─── Реестр КП (MyTKO) — волна 23 ──────────────────────────────────────────

export interface AreaItem {
  /** Код КП из личного кабинета MyTKO */
  lkCode: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

export interface AreasResponse {
  items: AreaItem[];
  /** Найдено под текущий фильтр (для пагинации) */
  total: number;
  page: number;
  pages: number;
  take: number;
  /** Когда реестр загружался из MyTKO; null — ещё ни разу (нужен синк) */
  areasSyncedAt: string | null;
  /** Всего площадок в реестре (без фильтра) */
  areasCount: number;
}

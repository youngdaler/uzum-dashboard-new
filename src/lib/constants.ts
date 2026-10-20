import type {
  AllocationMethod,
  BatchStatus,
  Currency,
  MovementType,
  PaymentMethod,
  SaleStatus,
} from '@/types/db'

export interface DefaultCategory {
  code: string
  name: string
  cost_type: 'landed' | 'operating'
}

/** Категории расходов по умолчанию. 'landed' — входит в себестоимость партии. */
export const DEFAULT_EXPENSE_CATEGORIES: DefaultCategory[] = [
  { code: 'cargo', name: 'Карго Китай → Узбекистан', cost_type: 'landed' },
  { code: 'pickup', name: 'Забор товара у поставщика', cost_type: 'landed' },
  { code: 'china_delivery', name: 'Доставка до склада в Китае', cost_type: 'landed' },
  { code: 'intermediary', name: 'Услуги посредника', cost_type: 'landed' },
  { code: 'payment_fee', name: 'Комиссия за оплату поставщику', cost_type: 'landed' },
  { code: 'packaging_marking', name: 'Упаковка и маркировка', cost_type: 'landed' },
  { code: 'customs', name: 'Таможенные платежи', cost_type: 'landed' },
  { code: 'certification', name: 'Сертификация и документы', cost_type: 'landed' },
  { code: 'broker', name: 'Брокерские услуги', cost_type: 'landed' },
  { code: 'local_delivery', name: 'Доставка по Узбекистану', cost_type: 'landed' },
  { code: 'other_landed', name: 'Прочие расходы партии', cost_type: 'landed' },
  { code: 'advertising', name: 'Реклама', cost_type: 'operating' },
  { code: 'packaging', name: 'Упаковка (операционная)', cost_type: 'operating' },
  { code: 'marketplace_fee', name: 'Комиссии и сборы маркетплейса (вне заказов)', cost_type: 'operating' },
  { code: 'taxes', name: 'Налоги', cost_type: 'operating' },
  { code: 'rent', name: 'Аренда и склад', cost_type: 'operating' },
  { code: 'salary', name: 'Зарплата', cost_type: 'operating' },
  { code: 'other', name: 'Прочее', cost_type: 'operating' },
]

export const DEFAULT_PRODUCT_CATEGORIES = ['Электроника', 'Дом и кухня', 'Одежда и обувь', 'Аксессуары', 'Прочее']

/** Расходы партии, считающиеся «логистикой» (остальные landed — «дополнительные»). */
export const LOGISTICS_CODES = new Set(['cargo', 'pickup', 'china_delivery', 'local_delivery'])

export const TAX_CODE = 'taxes'

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  ordered: 'Заказана',
  paid: 'Оплачена',
  shipped: 'Отправлена',
  in_transit: 'В пути',
  customs: 'На таможне',
  received: 'Получена',
  selling: 'Реализуется',
  closed: 'Закрыта',
}
export const BATCH_STATUSES = Object.keys(BATCH_STATUS_LABEL) as BatchStatus[]
/** Статусы, в которых партия ещё не на складе (ожидается). */
export const INBOUND_STATUSES: BatchStatus[] = ['ordered', 'paid', 'shipped', 'in_transit', 'customs']

export const ALLOCATION_LABEL: Record<AllocationMethod, string> = {
  quantity: 'По количеству',
  value: 'По закупочной стоимости',
  weight: 'По фактическому весу',
  volume: 'По объёму',
}

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  opening: 'Начальный остаток',
  receipt: 'Поступление',
  sale: 'Продажа',
  return: 'Возврат',
  writeoff: 'Списание',
  defect: 'Брак',
  adjustment: 'Корректировка',
}

export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  in_progress: 'В работе',
  completed: 'Завершена',
  cancelled: 'Отменена',
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Наличные',
  card: 'Карта',
  transfer: 'Перевод',
  other: 'Другое',
}

export const CURRENCIES: Currency[] = ['UZS', 'CNY', 'USD']

export const COST_METHOD_LABEL = {
  wac: 'Средневзвешенная',
  fifo: 'FIFO',
} as const

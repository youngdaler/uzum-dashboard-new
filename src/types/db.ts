/**
 * Типы строк БД. Имена полей 1:1 совпадают с колонками Supabase (snake_case),
 * поэтому между БД и приложением нет слоя маппинга.
 * numeric-колонки приходят как number; все вычисления выполняются через Decimal (lib/money).
 */

export type Currency = 'UZS' | 'CNY' | 'USD'
export type CostMethod = 'fifo' | 'wac'
export type AllocationMethod = 'quantity' | 'value' | 'weight' | 'volume'

export interface BaseRow {
  id: string
  user_id: string
  created_at: string
}

export interface Profile {
  id: string
  full_name: string
  business_name: string
  base_currency: 'UZS'
  language: 'ru' | 'uz'
  cost_method: CostMethod
  tax_mode: 'estimate' | 'actual'
  tax_rate_pct: number
  tax_base: 'revenue' | 'profit'
  default_min_stock: number
  export_format: 'csv' | 'xlsx'
  created_at: string
  updated_at: string
}

export interface Category extends BaseRow {
  kind: 'product' | 'expense'
  code: string | null
  name: string
  cost_type: 'landed' | 'operating' | null
  is_demo: boolean
}

export interface Supplier extends BaseRow {
  name: string
  contact: string | null
  url: string | null
  notes: string | null
  is_demo: boolean
}

export interface Product extends BaseRow {
  name: string
  sku: string
  barcode: string | null
  category_id: string | null
  photo_url: string | null
  source_url: string | null
  supplier_id: string | null
  purchase_price_cny: number
  recommended_price_uzs: number
  sale_price_uzs: number
  commission_pct: number | null
  packaging_cost_uzs: number
  extra_cost_uzs: number
  weight_kg: number
  volume_m3: number
  min_stock: number
  expected_monthly_sales: number | null
  status: 'active' | 'archived'
  is_demo: boolean
}

export type BatchStatus =
  | 'ordered'
  | 'paid'
  | 'shipped'
  | 'in_transit'
  | 'customs'
  | 'received'
  | 'selling'
  | 'closed'

export interface PurchaseBatch extends BaseRow {
  batch_no: string
  order_date: string
  received_date: string | null
  supplier_id: string | null
  order_url: string | null
  status: BatchStatus
  cny_rate: number
  prepayment_cny: number
  allocation_method: AllocationMethod
  actual_weight_kg: number
  volume_m3: number
  cargo_tariff_kg: number
  cargo_tariff_m3: number
  cargo_currency: Currency
  notes: string | null
  is_demo: boolean
}

export interface PurchaseBatchItem extends BaseRow {
  batch_id: string
  product_id: string
  qty_ordered: number
  qty_received: number
  qty_defective: number
  unit_price_cny: number
  unit_weight_kg: number
  unit_volume_m3: number
  planned_sale_price_uzs: number
}

export type ExpenseScope = 'batch' | 'item' | 'operating'
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'other'

export interface Expense extends BaseRow {
  expense_date: string
  category_id: string
  amount: number
  currency: Currency
  rate_to_uzs: number
  amount_uzs: number
  scope: ExpenseScope
  batch_id: string | null
  batch_item_id: string | null
  allocation_method: AllocationMethod | null
  payment_method: PaymentMethod
  payment_status: 'paid' | 'pending'
  due_date: string | null
  comment: string | null
  is_demo: boolean
}

export interface ExpenseAllocation extends BaseRow {
  expense_id: string
  batch_item_id: string
  amount_uzs: number
}

export type SaleStatus = 'in_progress' | 'completed' | 'cancelled'

export interface Sale extends BaseRow {
  order_no: string
  sale_date: string
  status: SaleStatus
  payout_actual_uzs: number | null
  payout_received_date: string | null
  notes: string | null
  is_demo: boolean
}

export interface SaleItem extends BaseRow {
  sale_id: string
  product_id: string
  qty: number
  unit_price_uzs: number
  seller_discount_uzs: number
  commission_uzs: number
  commission_pct: number | null
  logistics_uzs: number
  ads_uzs: number
  other_deductions_uzs: number
  packaging_uzs: number
  extra_cost_uzs: number
}

export type MovementType =
  | 'opening'
  | 'receipt'
  | 'sale'
  | 'return'
  | 'writeoff'
  | 'defect'
  | 'adjustment'

export interface InventoryMovement extends BaseRow {
  product_id: string
  batch_id: string | null
  batch_item_id: string | null
  sale_item_id: string | null
  return_id: string | null
  movement_date: string
  type: MovementType
  qty: number
  unit_cost_uzs: number | null
  note: string | null
}

export interface ReturnRow extends BaseRow {
  sale_item_id: string
  return_date: string
  kind: 'return' | 'damaged'
  qty: number
  restock: boolean
  refund_uzs: number
  commission_refund_uzs: number
  return_logistics_uzs: number
  compensation_uzs: number
  note: string | null
}

export interface ExchangeRate extends BaseRow {
  rate_date: string
  pair: 'CNY_UZS' | 'USD_UZS'
  rate: number
}

export interface FeeSetting extends BaseRow {
  category_id: string | null
  effective_from: string
  commission_pct: number
  logistics_fee_uzs: number
  processing_fee_uzs: number
  other_pct: number
  note: string | null
}

export type PaymentKind = 'supplier' | 'owner_in' | 'owner_out'

export interface Payment extends BaseRow {
  kind: PaymentKind
  payment_date: string
  due_date: string | null
  status: 'paid' | 'scheduled'
  batch_id: string | null
  amount: number
  currency: Currency
  rate_to_uzs: number
  amount_uzs: number
  note: string | null
  is_demo: boolean
}

export interface ProductEvaluation extends BaseRow {
  name: string
  supplier_price_cny: number
  moq: number
  cny_rate: number
  unit_weight_kg: number
  delivery_per_unit_uzs: number
  sale_price_uzs: number
  commission_pct: number
  selling_costs_per_unit_uzs: number
  monthly_sales: number | null
  defect_return_pct: number
  budget_uzs: number | null
  notes: string | null
  is_demo: boolean
  updated_at: string
}

/** Все таблицы, которые приложение загружает целиком. */
export interface Db {
  profile: Profile | null
  categories: Category[]
  suppliers: Supplier[]
  products: Product[]
  purchase_batches: PurchaseBatch[]
  purchase_batch_items: PurchaseBatchItem[]
  expenses: Expense[]
  expense_allocations: ExpenseAllocation[]
  sales: Sale[]
  sale_items: SaleItem[]
  inventory_movements: InventoryMovement[]
  returns: ReturnRow[]
  exchange_rates: ExchangeRate[]
  marketplace_fee_settings: FeeSetting[]
  payments: Payment[]
  product_evaluations: ProductEvaluation[]
}

export type TableName = Exclude<keyof Db, 'profile'>

export const TABLE_NAMES: TableName[] = [
  'categories',
  'suppliers',
  'products',
  'purchase_batches',
  'purchase_batch_items',
  'expenses',
  'expense_allocations',
  'sales',
  'sale_items',
  'inventory_movements',
  'returns',
  'exchange_rates',
  'marketplace_fee_settings',
  'payments',
  'product_evaluations',
]

export function emptyDb(): Db {
  return {
    profile: null,
    categories: [],
    suppliers: [],
    products: [],
    purchase_batches: [],
    purchase_batch_items: [],
    expenses: [],
    expense_allocations: [],
    sales: [],
    sale_items: [],
    inventory_movements: [],
    returns: [],
    exchange_rates: [],
    marketplace_fee_settings: [],
    payments: [],
    product_evaluations: [],
  }
}

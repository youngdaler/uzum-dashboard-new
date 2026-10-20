import { buildDemoData, DEMO_INSERT_ORDER } from '@/data/seed'
import {
  getDerived,
  getState,
  insertRow,
  insertRows,
  refresh,
  removeRows,
  updateProfile,
  updateRow,
} from '@/data/store'
import { D, toUzs } from '@/lib/money'
import { todayIso } from '@/lib/format'
import type {
  AllocationMethod,
  Currency,
  Expense,
  ExpenseAllocation,
  ExpenseScope,
  ExchangeRate,
  FeeSetting,
  InventoryMovement,
  Payment,
  PaymentMethod,
  Product,
  ProductEvaluation,
  PurchaseBatch,
  PurchaseBatchItem,
  ReturnRow,
  Sale,
  SaleItem,
  SaleStatus,
  Supplier,
  BatchStatus,
  Category,
  MovementType,
} from '@/types/db'

const db = () => getState().db

/** Оборачивает составную операцию: при сбое перезагружает данные, чтобы кэш не разошёлся с хранилищем. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    await refresh().catch(() => undefined)
    throw e
  }
}

// ---------------------------------------------------------------------------
// Справочники
// ---------------------------------------------------------------------------
export async function saveSupplier(id: string | null, v: Pick<Supplier, 'name' | 'contact' | 'url' | 'notes'>) {
  return id ? updateRow<Supplier>('suppliers', id, v) : insertRow<Supplier>('suppliers', { ...v, is_demo: false })
}
export const deleteSupplier = (id: string) => removeRows('suppliers', [id])

export async function saveCategory(
  id: string | null,
  v: { kind: 'product' | 'expense'; name: string; cost_type: 'landed' | 'operating' | null },
) {
  if (id) return updateRow<Category>('categories', id, { name: v.name })
  return insertRow<Category>('categories', { ...v, code: null, is_demo: false })
}
export const deleteCategory = (id: string) => removeRows('categories', [id])

// ---------------------------------------------------------------------------
// Товары
// ---------------------------------------------------------------------------
export type ProductValues = Omit<Product, 'id' | 'user_id' | 'created_at' | 'is_demo'>

export async function saveProduct(id: string | null, v: ProductValues): Promise<Product> {
  const sku = v.sku.trim()
  const dup = db().products.find((p) => p.sku.toLowerCase() === sku.toLowerCase() && p.id !== id)
  if (dup) throw new Error(`Артикул «${sku}» уже используется товаром «${dup.name}».`)
  return id
    ? updateRow<Product>('products', id, { ...v, sku })
    : insertRow<Product>('products', { ...v, sku, is_demo: false })
}

export const archiveProduct = (id: string, archived: boolean) =>
  updateRow<Product>('products', id, { status: archived ? 'archived' : 'active' })

export async function deleteProduct(id: string): Promise<void> {
  await removeRows('products', [id])
}

// ---------------------------------------------------------------------------
// Курсы и тарифы
// ---------------------------------------------------------------------------
export function latestRate(pair: 'CNY_UZS' | 'USD_UZS', onOrBefore?: string): number | null {
  const list = db()
    .exchange_rates.filter((r) => r.pair === pair && (!onOrBefore || r.rate_date <= onOrBefore))
    .sort((a, b) => b.rate_date.localeCompare(a.rate_date) || b.created_at.localeCompare(a.created_at))
  return list[0]?.rate ?? null
}

export function rateFor(currency: Currency, date: string): number | null {
  if (currency === 'UZS') return 1
  return latestRate(currency === 'CNY' ? 'CNY_UZS' : 'USD_UZS', date) ?? latestRate(currency === 'CNY' ? 'CNY_UZS' : 'USD_UZS')
}

export async function saveRate(pair: 'CNY_UZS' | 'USD_UZS', rate: number, date: string): Promise<void> {
  const existing = db().exchange_rates.find((r) => r.pair === pair && r.rate_date === date)
  if (existing) await updateRow<ExchangeRate>('exchange_rates', existing.id, { rate })
  else await insertRow<ExchangeRate>('exchange_rates', { pair, rate, rate_date: date })
}
export const deleteRate = (id: string) => removeRows('exchange_rates', [id])

export type FeeValues = Pick<
  FeeSetting,
  'category_id' | 'effective_from' | 'commission_pct' | 'logistics_fee_uzs' | 'processing_fee_uzs' | 'other_pct' | 'note'
>
export const addFeeSetting = (v: FeeValues) => insertRow<FeeSetting>('marketplace_fee_settings', v)
export const deleteFeeSetting = (id: string) => removeRows('marketplace_fee_settings', [id])

// ---------------------------------------------------------------------------
// Партии закупок
// ---------------------------------------------------------------------------
export type BatchValues = Omit<PurchaseBatch, 'id' | 'user_id' | 'created_at' | 'is_demo'>
export interface BatchItemValues {
  id?: string
  product_id: string
  qty_ordered: number
  qty_received: number
  qty_defective: number
  unit_price_cny: number
  unit_weight_kg: number
  unit_volume_m3: number
  planned_sale_price_uzs: number
}

export async function saveBatch(id: string | null, v: BatchValues, items: BatchItemValues[]): Promise<PurchaseBatch> {
  if (items.length === 0) throw new Error('Добавьте в партию хотя бы один товар.')
  const no = v.batch_no.trim()
  if (db().purchase_batches.some((b) => b.batch_no === no && b.id !== id))
    throw new Error(`Партия с номером «${no}» уже существует.`)
  const seen = new Set<string>()
  for (const it of items) {
    if (seen.has(it.product_id)) throw new Error('Один товар можно добавить в партию только один раз.')
    seen.add(it.product_id)
    if (it.qty_defective > it.qty_received) throw new Error('Брак не может превышать количество полученных единиц.')
  }

  return guarded(async () => {
    const batch = id
      ? await updateRow<PurchaseBatch>('purchase_batches', id, { ...v, batch_no: no })
      : await insertRow<PurchaseBatch>('purchase_batches', { ...v, batch_no: no, is_demo: false })

    const existing = db().purchase_batch_items.filter((i) => i.batch_id === batch.id)
    const keepIds = new Set(items.filter((i) => i.id).map((i) => i.id!))
    const toRemove = existing.filter((i) => !keepIds.has(i.id))
    for (const it of toRemove) {
      const sold = db().inventory_movements.some((m) => m.product_id === it.product_id && m.type === 'sale')
      if (it.qty_received > 0 && sold)
        throw new Error('Нельзя убрать из партии товар, по которому уже есть продажи.')
    }
    await removeRows('purchase_batch_items', toRemove.map((i) => i.id))

    for (const it of items) {
      const payload = {
        batch_id: batch.id,
        product_id: it.product_id,
        qty_ordered: it.qty_ordered,
        qty_received: it.qty_received,
        qty_defective: it.qty_defective,
        unit_price_cny: it.unit_price_cny,
        unit_weight_kg: it.unit_weight_kg,
        unit_volume_m3: it.unit_volume_m3,
        planned_sale_price_uzs: it.planned_sale_price_uzs,
      }
      if (it.id) await updateRow<PurchaseBatchItem>('purchase_batch_items', it.id, payload)
      else await insertRow<PurchaseBatchItem>('purchase_batch_items', payload)
    }
    await syncBatchReceipts(batch.id)
    await syncAllocations(batch.id)
    return batch
  })
}

export async function setBatchStatus(id: string, status: BatchStatus): Promise<void> {
  const b = db().purchase_batches.find((x) => x.id === id)
  if (!b) return
  const patch: Partial<PurchaseBatch> = { status }
  if (['received', 'selling', 'closed'].includes(status) && !b.received_date) patch.received_date = todayIso()
  await guarded(async () => {
    await updateRow<PurchaseBatch>('purchase_batches', id, patch)
    await syncBatchReceipts(id)
  })
}

export async function deleteBatch(id: string): Promise<void> {
  const d = getDerived()
  const sold = d.inventory.attribution.some((a) => a.batchId === id)
  if (sold) throw new Error('Нельзя удалить партию: по её товарам уже есть продажи.')
  await removeRows('purchase_batches', [id])
}

/** Один приход (receipt) на позицию партии = получено − брак. Создаёт, обновляет или удаляет движение. */
export async function syncBatchReceipts(batchId: string): Promise<void> {
  const batch = db().purchase_batches.find((b) => b.id === batchId)
  if (!batch) return
  const date = batch.received_date ?? batch.order_date
  const items = db().purchase_batch_items.filter((i) => i.batch_id === batchId)
  for (const it of items) {
    const good = it.qty_received - it.qty_defective
    const mv = db().inventory_movements.find((m) => m.type === 'receipt' && m.batch_item_id === it.id)
    if (good > 0) {
      if (!mv)
        await insertRow<InventoryMovement>('inventory_movements', {
          product_id: it.product_id,
          batch_id: batchId,
          batch_item_id: it.id,
          sale_item_id: null,
          return_id: null,
          movement_date: date,
          type: 'receipt',
          qty: good,
          unit_cost_uzs: null,
          note: null,
        })
      else if (mv.qty !== good || mv.movement_date !== date)
        await updateRow<InventoryMovement>('inventory_movements', mv.id, { qty: good, movement_date: date })
    } else if (mv) {
      await removeRows('inventory_movements', [mv.id])
    }
  }
}

/** Пересчитывает производную таблицу expense_allocations для партии (сумма долей = сумма расхода). */
export async function syncAllocations(batchId: string): Promise<void> {
  const calc = getDerived().batchCalcs.get(batchId)
  if (!calc) return
  const expenseIds = new Set(db().expenses.filter((e) => e.batch_id === batchId).map((e) => e.id))
  const current = db().expense_allocations.filter((a) => expenseIds.has(a.expense_id))
  const key = (e: string, i: string) => `${e}|${i}`
  const want = new Map(calc.allocations.map((a) => [key(a.expense_id, a.batch_item_id), a.amount_uzs]))
  const have = new Map(current.map((a) => [key(a.expense_id, a.batch_item_id), a]))

  const stale = current.filter((a) => !want.has(key(a.expense_id, a.batch_item_id)))
  await removeRows('expense_allocations', stale.map((a) => a.id))

  const toInsert: Partial<ExpenseAllocation>[] = []
  for (const [k, amount] of want) {
    const cur = have.get(k)
    if (!cur) {
      const [expense_id, batch_item_id] = k.split('|')
      toInsert.push({ expense_id, batch_item_id, amount_uzs: amount.toNumber() })
    } else if (!D(cur.amount_uzs).eq(amount)) {
      await updateRow<ExpenseAllocation>('expense_allocations', cur.id, { amount_uzs: amount.toNumber() })
    }
  }
  if (toInsert.length) await insertRows<ExpenseAllocation>('expense_allocations', toInsert)
}

// ---------------------------------------------------------------------------
// Расходы
// ---------------------------------------------------------------------------
export interface ExpenseValues {
  expense_date: string
  category_id: string
  amount: number
  currency: Currency
  rate_to_uzs: number
  batch_id: string | null
  batch_item_id: string | null
  allocation_method: AllocationMethod | null
  payment_method: PaymentMethod
  payment_status: 'paid' | 'pending'
  due_date: string | null
  comment: string | null
}

export async function saveExpense(id: string | null, v: ExpenseValues): Promise<Expense> {
  const cat = db().categories.find((c) => c.id === v.category_id)
  if (!cat) throw new Error('Выберите категорию расхода.')
  const landed = cat.cost_type === 'landed'
  if (landed && !v.batch_id) throw new Error('Расход этой категории входит в себестоимость партии — выберите партию.')
  const scope: ExpenseScope = !landed ? 'operating' : v.batch_item_id ? 'item' : 'batch'
  const rate = v.currency === 'UZS' ? 1 : v.rate_to_uzs
  if (v.currency !== 'UZS' && !(rate > 0)) throw new Error('Укажите курс валюты на дату операции.')
  const payload = {
    ...v,
    scope,
    batch_id: landed ? v.batch_id : null,
    batch_item_id: landed ? v.batch_item_id : null,
    allocation_method: landed && !v.batch_item_id ? v.allocation_method : null,
    rate_to_uzs: rate,
    amount_uzs: toUzs(v.amount, v.currency, rate).toNumber(),
    due_date: v.payment_status === 'pending' ? v.due_date : null,
  }
  const prevBatch = id ? db().expenses.find((e) => e.id === id)?.batch_id : null
  return guarded(async () => {
    const row = id
      ? await updateRow<Expense>('expenses', id, payload)
      : await insertRow<Expense>('expenses', { ...payload, is_demo: false })
    for (const b of new Set([prevBatch, row.batch_id].filter(Boolean) as string[])) await syncAllocations(b)
    return row
  })
}

export async function deleteExpense(id: string): Promise<void> {
  const e = db().expenses.find((x) => x.id === id)
  await guarded(async () => {
    await removeRows('expenses', [id])
    if (e?.batch_id) await syncAllocations(e.batch_id)
  })
}

export async function markExpensePaid(id: string): Promise<void> {
  await updateRow<Expense>('expenses', id, { payment_status: 'paid', due_date: null })
}

// ---------------------------------------------------------------------------
// Платежи
// ---------------------------------------------------------------------------
export interface PaymentValues {
  kind: Payment['kind']
  payment_date: string
  due_date: string | null
  status: 'paid' | 'scheduled'
  batch_id: string | null
  amount: number
  currency: Currency
  rate_to_uzs: number
  note: string | null
}

export async function savePayment(id: string | null, v: PaymentValues): Promise<Payment> {
  if (v.kind === 'supplier' && !v.batch_id) throw new Error('Выберите партию для платежа поставщику.')
  const rate = v.currency === 'UZS' ? 1 : v.rate_to_uzs
  const payload = { ...v, rate_to_uzs: rate, amount_uzs: toUzs(v.amount, v.currency, rate).toNumber() }
  return id ? updateRow<Payment>('payments', id, payload) : insertRow<Payment>('payments', { ...payload, is_demo: false })
}
export const deletePayment = (id: string) => removeRows('payments', [id])
export const markPaymentPaid = (id: string) =>
  updateRow<Payment>('payments', id, { status: 'paid', payment_date: todayIso(), due_date: null })

// ---------------------------------------------------------------------------
// Продажи
// ---------------------------------------------------------------------------
export interface SaleItemValues {
  id?: string
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
export interface SaleValues {
  order_no: string
  sale_date: string
  status: SaleStatus
  payout_actual_uzs: number | null
  payout_received_date: string | null
  notes: string | null
}

function stockOf(productId: string, excludeSaleItemIds: string[] = []): number {
  return db()
    .inventory_movements.filter((m) => m.product_id === productId && !(m.sale_item_id && excludeSaleItemIds.includes(m.sale_item_id)))
    .reduce((s, m) => s + m.qty, 0)
}

export async function saveSale(id: string | null, v: SaleValues, items: SaleItemValues[]): Promise<Sale> {
  if (items.length === 0) throw new Error('Добавьте в заказ хотя бы один товар.')
  const orderNo = v.order_no.trim()
  if (db().sales.some((s) => s.order_no === orderNo && s.id !== id)) throw new Error(`Заказ «${orderNo}» уже зарегистрирован.`)
  for (const it of items) {
    if (it.seller_discount_uzs > it.unit_price_uzs * it.qty) throw new Error('Скидка не может превышать стоимость позиции.')
  }
  if (v.status === 'completed') {
    const ownIds = db().sale_items.filter((i) => i.sale_id === id).map((i) => i.id)
    const need = new Map<string, number>()
    for (const it of items) need.set(it.product_id, (need.get(it.product_id) ?? 0) + it.qty)
    for (const [pid, qty] of need) {
      const have = stockOf(pid, ownIds)
      if (qty > have) {
        const name = db().products.find((p) => p.id === pid)?.name ?? 'товар'
        throw new Error(`Недостаточно остатка: «${name}» — на складе ${have}, в заказе ${qty}.`)
      }
    }
  }
  return guarded(async () => {
    const header = { ...v, order_no: orderNo, payout_received_date: v.status === 'completed' ? v.payout_received_date : null }
    const sale = id
      ? await updateRow<Sale>('sales', id, header)
      : await insertRow<Sale>('sales', { ...header, is_demo: false })

    const existing = db().sale_items.filter((i) => i.sale_id === sale.id)
    const keep = new Set(items.filter((i) => i.id).map((i) => i.id!))
    await removeRows('sale_items', existing.filter((i) => !keep.has(i.id)).map((i) => i.id))
    for (const it of items) {
      const { id: itemId, ...rest } = it
      if (itemId) await updateRow<SaleItem>('sale_items', itemId, rest)
      else await insertRow<SaleItem>('sale_items', { ...rest, sale_id: sale.id })
    }
    await syncSaleMovements(sale.id)
    return sale
  })
}

/** Движение «продажа» существует только у завершённых заказов (отменённые и «в работе» склад не меняют). */
export async function syncSaleMovements(saleId: string): Promise<void> {
  const sale = db().sales.find((s) => s.id === saleId)
  if (!sale) return
  for (const it of db().sale_items.filter((i) => i.sale_id === saleId)) {
    const mv = db().inventory_movements.find((m) => m.type === 'sale' && m.sale_item_id === it.id)
    if (sale.status === 'completed') {
      if (!mv)
        await insertRow<InventoryMovement>('inventory_movements', {
          product_id: it.product_id,
          batch_id: null,
          batch_item_id: null,
          sale_item_id: it.id,
          return_id: null,
          movement_date: sale.sale_date,
          type: 'sale',
          qty: -it.qty,
          unit_cost_uzs: null,
          note: null,
        })
      else if (mv.qty !== -it.qty || mv.movement_date !== sale.sale_date || mv.product_id !== it.product_id)
        await updateRow<InventoryMovement>('inventory_movements', mv.id, {
          qty: -it.qty,
          movement_date: sale.sale_date,
          product_id: it.product_id,
        })
    } else if (mv) await removeRows('inventory_movements', [mv.id])
  }
}

export async function deleteSale(id: string): Promise<void> {
  await removeRows('sales', [id])
}

export async function markPayoutReceived(saleId: string, date: string, actual: number | null): Promise<void> {
  await updateRow<Sale>('sales', saleId, { payout_received_date: date, payout_actual_uzs: actual })
}

// ---------------------------------------------------------------------------
// Возвраты и повреждения
// ---------------------------------------------------------------------------
export type ReturnValues = Omit<ReturnRow, 'id' | 'user_id' | 'created_at'>

export function returnedQty(saleItemId: string, excludeReturnId?: string): number {
  return db()
    .returns.filter((r) => r.sale_item_id === saleItemId && r.id !== excludeReturnId)
    .reduce((s, r) => s + r.qty, 0)
}

export async function saveReturn(id: string | null, v: ReturnValues): Promise<ReturnRow> {
  const item = db().sale_items.find((i) => i.id === v.sale_item_id)
  if (!item) throw new Error('Строка продажи не найдена.')
  const sale = db().sales.find((s) => s.id === item.sale_id)
  if (sale?.status !== 'completed') throw new Error('Возврат возможен только по завершённому заказу.')
  const already = returnedQty(item.id, id ?? undefined)
  if (v.qty + already > item.qty) throw new Error(`Нельзя вернуть больше проданного: продано ${item.qty}, уже возвращено ${already}.`)
  if (v.kind === 'damaged' && v.restock) throw new Error('Повреждённый товар нельзя вернуть на склад как годный.')
  return guarded(async () => {
    const row = id ? await updateRow<ReturnRow>('returns', id, v) : await insertRow<ReturnRow>('returns', v)
    const mv = db().inventory_movements.find((m) => m.return_id === row.id)
    if (row.restock) {
      if (!mv)
        await insertRow<InventoryMovement>('inventory_movements', {
          product_id: item.product_id,
          batch_id: null,
          batch_item_id: null,
          sale_item_id: null,
          return_id: row.id,
          movement_date: row.return_date,
          type: 'return',
          qty: row.qty,
          unit_cost_uzs: null,
          note: null,
        })
      else await updateRow<InventoryMovement>('inventory_movements', mv.id, { qty: row.qty, movement_date: row.return_date })
    } else if (mv) await removeRows('inventory_movements', [mv.id])
    return row
  })
}
export const deleteReturn = (id: string) => removeRows('returns', [id])

// ---------------------------------------------------------------------------
// Склад: ручные движения
// ---------------------------------------------------------------------------
export interface StockMovementValues {
  product_id: string
  type: Extract<MovementType, 'opening' | 'writeoff' | 'defect' | 'adjustment'>
  /** Для adjustment — со знаком; для остальных — положительное количество. */
  qty: number
  unit_cost_uzs: number | null
  movement_date: string
  note: string | null
}

export async function addStockMovement(v: StockMovementValues): Promise<void> {
  const q = Math.trunc(v.qty)
  if (q === 0) throw new Error('Укажите количество.')
  const signed = v.type === 'opening' ? Math.abs(q) : v.type === 'adjustment' ? q : -Math.abs(q)
  if (signed < 0 && stockOf(v.product_id) + signed < 0) {
    throw new Error(`Недостаточно остатка: на складе ${stockOf(v.product_id)}.`)
  }
  if (v.type === 'opening' && !(D(v.unit_cost_uzs).gte(0) && v.unit_cost_uzs !== null))
    throw new Error('Для начального остатка укажите себестоимость единицы.')
  await insertRow<InventoryMovement>('inventory_movements', {
    product_id: v.product_id,
    batch_id: null,
    batch_item_id: null,
    sale_item_id: null,
    return_id: null,
    movement_date: v.movement_date,
    type: v.type,
    qty: signed,
    unit_cost_uzs: v.type === 'opening' || (v.type === 'adjustment' && signed > 0) ? v.unit_cost_uzs : null,
    note: v.note,
  })
}

export async function deleteMovement(id: string): Promise<void> {
  const m = db().inventory_movements.find((x) => x.id === id)
  if (!m) return
  if (m.type === 'receipt' || m.type === 'sale' || m.type === 'return')
    throw new Error('Приходы, продажи и возвраты изменяются через партии, продажи и возвраты.')
  await removeRows('inventory_movements', [id])
}

// ---------------------------------------------------------------------------
// Оценка закупок
// ---------------------------------------------------------------------------
export type EvaluationValues = Omit<ProductEvaluation, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'is_demo'>
export const saveEvaluation = (id: string | null, v: EvaluationValues) =>
  id ? updateRow<ProductEvaluation>('product_evaluations', id, v) : insertRow<ProductEvaluation>('product_evaluations', { ...v, is_demo: false })
export const deleteEvaluation = (id: string) => removeRows('product_evaluations', [id])

// ---------------------------------------------------------------------------
// Демо-данные
// ---------------------------------------------------------------------------
export function hasDemoData(): boolean {
  const d = db()
  return d.products.some((p) => p.is_demo) || d.sales.some((s) => s.is_demo) || d.purchase_batches.some((b) => b.is_demo)
}

export async function loadDemoData(): Promise<void> {
  if (hasDemoData()) throw new Error('Демо-данные уже загружены.')
  const rows = buildDemoData(db())
  await guarded(async () => {
    for (const t of DEMO_INSERT_ORDER) {
      const list = rows[t]
      if (list?.length) await insertRows(t, list as never[])
    }
    for (const b of db().purchase_batches.filter((x) => x.is_demo)) await syncAllocations(b.id)
  })
}

/** Удаляет только строки, помеченные is_demo (и привязанные к ним), в порядке зависимостей. */
export async function clearDemoData(): Promise<void> {
  await guarded(async () => {
    const d = () => db()
    await removeRows('sales', d().sales.filter((s) => s.is_demo).map((s) => s.id))
    await removeRows('purchase_batches', d().purchase_batches.filter((b) => b.is_demo).map((b) => b.id))
    await removeRows('expenses', d().expenses.filter((e) => e.is_demo).map((e) => e.id))
    await removeRows('payments', d().payments.filter((p) => p.is_demo).map((p) => p.id))
    await removeRows('product_evaluations', d().product_evaluations.filter((e) => e.is_demo).map((e) => e.id))
    // остатки и движения демо-товаров (например, списание) удаляются вместе с движениями
    const demoProducts = d().products.filter((p) => p.is_demo).map((p) => p.id)
    await removeRows('inventory_movements', d().inventory_movements.filter((m) => demoProducts.includes(m.product_id)).map((m) => m.id))
    await removeRows('products', demoProducts)
    await removeRows('suppliers', d().suppliers.filter((s) => s.is_demo).map((s) => s.id))
    await removeRows('marketplace_fee_settings', d().marketplace_fee_settings.filter((f) => f.note?.startsWith('ДЕМО')).map((f) => f.id))
  })
}

// ---------------------------------------------------------------------------
// Настройки профиля
// ---------------------------------------------------------------------------
export { updateProfile }

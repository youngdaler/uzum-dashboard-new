import { calcBatch, type BatchCalc, type SellingParams } from '@/lib/calc/batch'
import { buildFinanceContext, type FinanceContext } from '@/lib/calc/finance'
import { computeInventory, type InventoryResult, type ReceiptCost } from '@/lib/calc/inventory'
import type { Category, Db, FeeSetting, Product, PurchaseBatchItem } from '@/types/db'

/** Действующий тариф Uzum на дату: для категории, иначе общий; последняя запись с effective_from <= дата. */
export function feeFor(db: Db, categoryId: string | null, date: string): FeeSetting | null {
  const pick = (cat: string | null): FeeSetting | null => {
    const list = db.marketplace_fee_settings
      .filter((f) => f.category_id === cat && f.effective_from <= date)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at))
    return list[0] ?? null
  }
  return (categoryId ? pick(categoryId) : null) ?? pick(null)
}

/** Параметры реализации товара: комиссия — из карточки товара, иначе из тарифов; логистика — из тарифов. */
export function sellingParamsFor(db: Db, product: Product | undefined, date: string): SellingParams {
  const fee = feeFor(db, product?.category_id ?? null, date)
  return {
    commissionPct: product?.commission_pct ?? fee?.commission_pct ?? 0,
    logistics: (fee?.logistics_fee_uzs ?? 0) + (fee?.processing_fee_uzs ?? 0),
    otherPct: fee?.other_pct ?? 0,
    otherFixed: 0,
    packaging: product?.packaging_cost_uzs ?? 0,
    extra: product?.extra_cost_uzs ?? 0,
    ads: 0,
  }
}

export interface Derived {
  categoriesById: Map<string, Category>
  productsById: Map<string, Product>
  batchCalcs: Map<string, BatchCalc>
  itemsByBatch: Map<string, PurchaseBatchItem[]>
  inventory: InventoryResult
  finance: FinanceContext
}

/** Строит все производные показатели из «сырых» таблиц. Вызывается при любом изменении данных. */
export function derive(db: Db): Derived {
  const categoriesById = new Map(db.categories.map((c) => [c.id, c]))
  const productsById = new Map(db.products.map((p) => [p.id, p]))

  const itemsByBatch = new Map<string, PurchaseBatchItem[]>()
  for (const it of db.purchase_batch_items) {
    const arr = itemsByBatch.get(it.batch_id) ?? []
    arr.push(it)
    itemsByBatch.set(it.batch_id, arr)
  }
  const expensesByBatch = new Map<string, typeof db.expenses>()
  for (const e of db.expenses) {
    if (!e.batch_id) continue
    const arr = expensesByBatch.get(e.batch_id) ?? []
    arr.push(e)
    expensesByBatch.set(e.batch_id, arr)
  }

  const batchCalcs = new Map<string, BatchCalc>()
  for (const b of db.purchase_batches) {
    batchCalcs.set(
      b.id,
      calcBatch({
        batch: b,
        items: itemsByBatch.get(b.id) ?? [],
        expenses: expensesByBatch.get(b.id) ?? [],
        categories: categoriesById,
        payments: db.payments,
        sellingParams: (it) => sellingParamsFor(db, productsById.get(it.product_id), b.order_date),
        monthlySales: (it) => productsById.get(it.product_id)?.expected_monthly_sales ?? null,
      }),
    )
  }

  const receiptCosts = new Map<string, ReceiptCost>()
  for (const calc of batchCalcs.values()) {
    for (const ic of calc.items) receiptCosts.set(ic.item_id, { totalUzs: ic.totalUzs, qtyBasis: ic.qtyBasis })
  }

  const inventory = computeInventory({
    method: db.profile?.cost_method ?? 'wac',
    movements: db.inventory_movements,
    receiptCosts,
    saleItems: db.sale_items,
    sales: db.sales,
    returns: db.returns,
    productIds: db.products.map((p) => p.id),
  })

  const finance = buildFinanceContext({ db, batchCalcs, inventory, categories: categoriesById })
  return { categoriesById, productsById, batchCalcs, itemsByBatch, inventory, finance }
}

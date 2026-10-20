import { feeFor, sellingParamsFor, type Derived } from '@/lib/calc/derive'
import { unitEconomics, type UnitResult } from '@/lib/calc/unit'
import type { ProductStock } from '@/lib/calc/inventory'
import { D, Decimal } from '@/lib/money'
import type { Db, Product } from '@/types/db'

export type CostSource = 'stock' | 'batch' | 'estimate' | 'none'

export const COST_SOURCE_LABEL: Record<CostSource, string> = {
  stock: 'по остатку на складе',
  batch: 'по последней партии',
  estimate: 'оценка: цена закупки × курс (без доставки)',
  none: 'нет данных',
}

export interface ProductRow {
  product: Product
  categoryName: string
  supplierName: string
  stock: ProductStock | undefined
  unitCost: Decimal | null
  costSource: CostSource
  unit: UnitResult | null
  effectiveCommissionPct: number
  /** Проданные единицы за всё время (по завершённым заказам). */
  sold: number
}

export function latestRateOf(db: Db, pair: 'CNY_UZS' | 'USD_UZS'): number | null {
  let best: { date: string; rate: number; at: string } | null = null
  for (const r of db.exchange_rates) {
    if (r.pair !== pair) continue
    if (!best || r.rate_date > best.date || (r.rate_date === best.date && r.created_at > best.at))
      best = { date: r.rate_date, rate: r.rate, at: r.created_at }
  }
  return best?.rate ?? null
}

/** Себестоимость единицы товара «сейчас»: по остатку → по последней партии → оценка по цене закупки. */
export function currentUnitCost(db: Db, d: Derived, p: Product): { cost: Decimal | null; source: CostSource } {
  const st = d.inventory.byProduct.get(p.id)
  if (st && st.stock > 0 && st.avgCost) return { cost: st.avgCost, source: 'stock' }
  const batches = db.purchase_batches.slice().sort((a, b) => b.order_date.localeCompare(a.order_date))
  for (const b of batches) {
    const it = d.batchCalcs.get(b.id)?.items.find((i) => i.product_id === p.id)
    if (it?.unitCostUzs) return { cost: it.unitCostUzs, source: 'batch' }
  }
  const rate = latestRateOf(db, 'CNY_UZS')
  if (rate && p.purchase_price_cny > 0) return { cost: D(p.purchase_price_cny).mul(rate), source: 'estimate' }
  return { cost: null, source: 'none' }
}

export function buildProductRows(db: Db, d: Derived, today: string): ProductRow[] {
  const cats = new Map(db.categories.map((c) => [c.id, c.name]))
  const sups = new Map(db.suppliers.map((s) => [s.id, s.name]))
  return db.products.map((p) => {
    const { cost, source } = currentUnitCost(db, d, p)
    const params = sellingParamsFor(db, p, today)
    const unit =
      cost !== null && p.sale_price_uzs > 0
        ? unitEconomics({
            price: p.sale_price_uzs,
            commissionPct: params.commissionPct,
            logistics: params.logistics,
            otherPct: params.otherPct,
            otherFixed: params.otherFixed,
            packaging: params.packaging,
            extra: params.extra,
            unitCost: cost,
          })
        : null
    const st = d.inventory.byProduct.get(p.id)
    return {
      product: p,
      categoryName: p.category_id ? (cats.get(p.category_id) ?? '—') : '—',
      supplierName: p.supplier_id ? (sups.get(p.supplier_id) ?? '—') : '—',
      stock: st,
      unitCost: cost,
      costSource: source,
      unit,
      effectiveCommissionPct: params.commissionPct,
      sold: st?.sold ?? 0,
    }
  })
}

export { feeFor }

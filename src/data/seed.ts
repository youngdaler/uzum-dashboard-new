import { addDays, format, subDays } from 'date-fns'
import type { AnyRow, Backend } from '@/data/backend'
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_PRODUCT_CATEGORIES } from '@/lib/constants'
import { toUzs } from '@/lib/money'
import type { Db, TableName } from '@/types/db'

/** Создаёт стандартные категории при первом входе. Возвращает обновлённое состояние. */
export async function ensureDefaults(backend: Backend, db: Db): Promise<Db> {
  if (db.categories.length > 0) return db
  const rows: AnyRow[] = [
    ...DEFAULT_EXPENSE_CATEGORIES.map((c) => ({
      id: crypto.randomUUID(),
      kind: 'expense',
      code: c.code,
      name: c.name,
      cost_type: c.cost_type,
      is_demo: false,
    })),
    ...DEFAULT_PRODUCT_CATEGORIES.map((name) => ({
      id: crypto.randomUUID(),
      kind: 'product',
      code: null,
      name,
      cost_type: null,
      is_demo: false,
    })),
  ]
  const created = await backend.insert('categories', rows)
  return { ...db, categories: created as unknown as Db['categories'] }
}

// ---------------------------------------------------------------------------
// Демонстрационные данные (все строки помечены is_demo = true и удаляются одной кнопкой)
// ---------------------------------------------------------------------------
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const uid = () => crypto.randomUUID()

export type DemoRows = Partial<Record<TableName, AnyRow[]>>

export const DEMO_NOTE = 'ДЕМО: примерное значение, замените на актуальный тариф Uzum'

/**
 * Генерирует связный демо-набор: поставщики, товары, 3 партии (в продаже, получена, в пути),
 * расходы, продажи за ~80 дней (с отменами, заказами в работе, возвратами), списание, оценки закупок.
 * Курсы и тарифы — условные, их нужно заменить своими в разделе «Настройки».
 */
export function buildDemoData(db: Db, today = new Date()): DemoRows {
  const rand = rng(20260101)
  const expCat = (code: string) => db.categories.find((c) => c.kind === 'expense' && c.code === code)!.id
  const prodCat = (name: string) => db.categories.find((c) => c.kind === 'product' && c.name === name)?.id ?? null
  const at = (date: string, n = 0) => `${date}T09:${String(n % 60).padStart(2, '0')}:00.000Z`

  const CNY = 1780
  const USD = 12650

  const suppliers = [
    { id: uid(), name: 'Guangzhou Trade Co.', contact: 'WeChat: gz_trade', url: 'https://www.1688.com', notes: null, is_demo: true },
    { id: uid(), name: 'Yiwu Home Mart', contact: 'WeChat: yiwu_home', url: 'https://www.taobao.com', notes: null, is_demo: true },
  ]

  const P = (
    name: string, sku: string, cat: string, supplier: number, cny: number, price: number, kg: number,
    min: number, monthly: number,
  ) => ({
    id: uid(), name, sku, barcode: null, category_id: prodCat(cat), photo_url: null,
    source_url: 'https://detail.1688.com/offer/demo.html', supplier_id: suppliers[supplier].id,
    purchase_price_cny: cny, recommended_price_uzs: price + 10_000, sale_price_uzs: price,
    commission_pct: null, packaging_cost_uzs: 1_500, extra_cost_uzs: 0, weight_kg: kg, volume_m3: 0,
    min_stock: min, expected_monthly_sales: monthly, status: 'active', is_demo: true,
    created_at: at(iso(subDays(today, 110))),
  })
  const products = [
    P('Беспроводные наушники TWS', 'TWS-001', 'Электроника', 0, 28, 169_000, 0.15, 25, 60),
    P('Умные часы Band 7', 'SW-210', 'Электроника', 0, 45, 239_000, 0.12, 15, 30),
    P('Силиконовые формы для выпечки', 'KT-110', 'Дом и кухня', 1, 6.5, 59_000, 0.3, 30, 80),
    P('Органайзер для кабелей', 'AC-305', 'Аксессуары', 0, 3.2, 29_000, 0.08, 50, 120),
    P('Чехол для смартфона', 'AC-401', 'Аксессуары', 1, 2.1, 25_000, 0.05, 60, 150),
    P('Настольная LED-лампа', 'HM-220', 'Дом и кухня', 1, 18, 119_000, 0.6, 10, 25),
  ]

  const fee = (from: string, cat: string | null, pct: number) => ({
    id: uid(), category_id: cat, effective_from: from, commission_pct: pct, logistics_fee_uzs: 6_000,
    processing_fee_uzs: 1_500, other_pct: 0, note: DEMO_NOTE, created_at: at(from),
  })
  const fees = [fee(iso(subDays(today, 120)), null, 10), fee(iso(subDays(today, 45)), prodCat('Электроника'), 8)]

  const rates = [90, 60, 30, 0].flatMap((d, i) => {
    const date = iso(subDays(today, d))
    return [
      { id: uid(), rate_date: date, pair: 'CNY_UZS', rate: CNY + i * 6, created_at: at(date) },
      { id: uid(), rate_date: date, pair: 'USD_UZS', rate: USD + i * 20, created_at: at(date, 1) },
    ]
  })

  // --- Партии ---
  const mkBatch = (no: string, orderAgo: number, recvAgo: number | null, status: string, supplier: number, prepay: number, rate: number) => ({
    id: uid(), batch_no: no, order_date: iso(subDays(today, orderAgo)),
    received_date: recvAgo === null ? null : iso(subDays(today, recvAgo)), supplier_id: suppliers[supplier].id,
    order_url: 'https://detail.1688.com/order/demo', status, cny_rate: rate, prepayment_cny: prepay,
    allocation_method: 'weight', actual_weight_kg: 0, volume_m3: 0, cargo_tariff_kg: 5, cargo_tariff_m3: 0,
    cargo_currency: 'USD', notes: 'Демо-партия', is_demo: true, created_at: at(iso(subDays(today, orderAgo))),
  })
  const bA = mkBatch('П-2026-001', 100, 70, 'selling', 0, 8_000, CNY)
  const bB = mkBatch('П-2026-002', 62, 28, 'received', 1, 3_000, CNY + 6)
  const bC = mkBatch('П-2026-003', 12, null, 'in_transit', 0, 5_000, CNY + 12)

  const mkItem = (b: { id: string; order_date: string }, p: (typeof products)[number], ord: number, rec: number, def: number, planned: number, cny?: number) => ({
    id: uid(), batch_id: b.id, product_id: p.id, qty_ordered: ord, qty_received: rec, qty_defective: def,
    unit_price_cny: cny ?? p.purchase_price_cny, unit_weight_kg: p.weight_kg, unit_volume_m3: 0,
    planned_sale_price_uzs: planned, created_at: at((b as { order_date: string }).order_date),
  })
  const itemsA = [mkItem(bA, products[0], 300, 300, 6, 169_000), mkItem(bA, products[1], 120, 120, 2, 239_000), mkItem(bA, products[3], 600, 600, 10, 29_000)]
  const itemsB = [mkItem(bB, products[2], 400, 398, 8, 59_000), mkItem(bB, products[4], 800, 800, 12, 25_000), mkItem(bB, products[5], 150, 150, 3, 119_000)]
  const itemsC = [mkItem(bC, products[0], 400, 0, 0, 175_000, 27), mkItem(bC, products[5], 100, 0, 0, 119_000, 17.5)]
  const batches = [bA, bB, bC]
  const items = [...itemsA, ...itemsB, ...itemsC]

  // --- Расходы партий ---
  const exp = (code: string, amount: number, cur: 'UZS' | 'CNY' | 'USD', rate: number, daysAgo: number, over: Record<string, unknown> = {}) => {
    const date = iso(subDays(today, daysAgo))
    return {
      id: uid(), expense_date: date, category_id: expCat(code), amount, currency: cur,
      rate_to_uzs: cur === 'UZS' ? 1 : rate, amount_uzs: toUzs(amount, cur, rate).toNumber(), scope: 'operating',
      batch_id: null, batch_item_id: null, allocation_method: null, payment_method: 'transfer',
      payment_status: 'paid', due_date: null, comment: null, is_demo: true, created_at: at(date), ...over,
    }
  }
  const forBatch = (b: { id: string }) => ({ scope: 'batch', batch_id: b.id })
  const expenses = [
    exp('cargo', 0.15 * 300 * 5 + 0.12 * 120 * 5 + 0.08 * 600 * 5, 'USD', USD, 72, forBatch(bA)),
    exp('customs', 2_400_000, 'UZS', 1, 69, forBatch(bA)),
    exp('intermediary', 600, 'CNY', CNY, 96, forBatch(bA)),
    exp('payment_fee', 150, 'CNY', CNY, 99, forBatch(bA)),
    exp('local_delivery', 450_000, 'UZS', 1, 68, forBatch(bA)),
    exp('cargo', 0.3 * 398 * 5 + 0.05 * 800 * 5 + 0.6 * 150 * 5, 'USD', USD, 30, forBatch(bB)),
    exp('customs', 1_800_000, 'UZS', 1, 29, forBatch(bB)),
    exp('intermediary', 450, 'CNY', CNY, 60, forBatch(bB)),
    exp('packaging_marking', 700_000, 'UZS', 1, 29, forBatch(bB)),
    exp('pickup', 300, 'CNY', CNY, 11, { ...forBatch(bC), payment_status: 'pending', due_date: iso(addDays(today, 5)) }),
    exp('advertising', 1_500_000, 'UZS', 1, 55),
    exp('advertising', 1_800_000, 'UZS', 1, 25),
    exp('advertising', 900_000, 'UZS', 1, 6),
    exp('rent', 2_000_000, 'UZS', 1, 40),
    exp('rent', 2_000_000, 'UZS', 1, 10),
    exp('taxes', 650_000, 'UZS', 1, 3, { payment_status: 'pending', due_date: iso(addDays(today, 9)) }),
  ]

  // --- Платежи ---
  const pay = (kind: string, amount: number, cur: 'UZS' | 'CNY', rate: number, daysAgo: number, over: Record<string, unknown> = {}) => {
    const date = iso(subDays(today, daysAgo))
    return {
      id: uid(), kind, payment_date: date, due_date: null, status: 'paid', batch_id: null, amount, currency: cur,
      rate_to_uzs: cur === 'UZS' ? 1 : rate, amount_uzs: toUzs(amount, cur, rate).toNumber(), note: 'Демо',
      is_demo: true, created_at: at(date), ...over,
    }
  }
  const payments = [
    pay('owner_in', 120_000_000, 'UZS', 1, 110),
    pay('supplier', 4_500, 'CNY', CNY, 85, { batch_id: bA.id }),
    pay('supplier', 6_000, 'CNY', CNY + 6, 50, { batch_id: bB.id }),
    pay('supplier', 3_500, 'CNY', CNY + 12, 2, { batch_id: bC.id, status: 'scheduled', due_date: iso(addDays(today, 4)) }),
  ]

  // --- Движения прихода ---
  const movements: AnyRow[] = []
  for (const [b, list] of [[bA, itemsA], [bB, itemsB]] as const) {
    for (const it of list) {
      const good = it.qty_received - it.qty_defective
      movements.push({
        id: uid(), product_id: it.product_id, batch_id: b.id, batch_item_id: it.id, sale_item_id: null,
        return_id: null, movement_date: b.received_date, type: 'receipt', qty: good, unit_cost_uzs: null,
        note: null, created_at: at(b.received_date!, 5),
      })
    }
  }
  const recvDateOf = (pid: string) => {
    const first = movements.filter((m) => m.product_id === pid).map((m) => m.movement_date as string).sort()[0]
    return first
  }
  const receivedByProduct = new Map<string, number>()
  for (const m of movements) receivedByProduct.set(m.product_id as string, (receivedByProduct.get(m.product_id as string) ?? 0) + (m.qty as number))

  // --- Продажи ---
  const sales: AnyRow[] = []
  const saleItems: AnyRow[] = []
  const returns: AnyRow[] = []
  const fx = (pct: number, rev: number) => Math.round((rev * pct) / 100)
  let orderNo = 5000
  const stockSim = new Map(receivedByProduct)
  const soldPerProduct = new Map<string, number>()
  for (let ago = 78; ago >= 0; ago--) {
    const date = iso(subDays(today, ago))
    const nOrders = Math.floor(rand() * 4) // 0..3
    for (let k = 0; k < nOrders; k++) {
      const p = products[Math.floor(rand() * products.length)]
      const recv = recvDateOf(p.id)
      if (!recv || recv > date) continue
      const qty = 1 + Math.floor(rand() * 3)
      const left = stockSim.get(p.id) ?? 0
      if (left < qty + 3) continue
      const roll = rand()
      const status = roll < 0.07 ? 'cancelled' : ago <= 2 && roll < 0.2 ? 'in_progress' : 'completed'
      const saleId = uid()
      const priceJitter = Math.round(p.sale_price_uzs * (1 - Math.floor(rand() * 3) * 0.03))
      const gross = priceJitter * qty
      const discount = rand() < 0.25 ? Math.round(gross * 0.05) : 0
      const revenue = gross - discount
      const pct = p.category_id === prodCat('Электроника') && date >= iso(subDays(today, 45)) ? 8 : 10
      const commission = fx(pct, revenue)
      const itemId = uid()
      orderNo += 1 + Math.floor(rand() * 3)
      sales.push({
        id: saleId, order_no: `UZ-${orderNo}`, sale_date: date, status,
        payout_actual_uzs: null,
        payout_received_date: status === 'completed' && ago > 14 ? iso(addDays(subDays(today, ago), 10)) : null,
        notes: null, is_demo: true, created_at: at(date, k + 10),
      })
      saleItems.push({
        id: itemId, sale_id: saleId, product_id: p.id, qty, unit_price_uzs: priceJitter,
        seller_discount_uzs: discount, commission_uzs: commission, commission_pct: pct,
        logistics_uzs: 7_500 * qty, ads_uzs: 0, other_deductions_uzs: 0, packaging_uzs: 1_500 * qty,
        extra_cost_uzs: 0, created_at: at(date, k + 10),
      })
      if (status === 'completed') {
        movements.push({
          id: uid(), product_id: p.id, batch_id: null, batch_item_id: null, sale_item_id: itemId, return_id: null,
          movement_date: date, type: 'sale', qty: -qty, unit_cost_uzs: null, note: null, created_at: at(date, k + 20),
        })
        stockSim.set(p.id, left - qty)
        soldPerProduct.set(p.id, (soldPerProduct.get(p.id) ?? 0) + qty)
        // редкие возвраты
        if (ago > 6 && rand() < 0.06) {
          const retId = uid()
          const rdate = iso(addDays(subDays(today, ago), 4))
          const damaged = rand() < 0.3
          returns.push({
            id: retId, sale_item_id: itemId, return_date: rdate, kind: damaged ? 'damaged' : 'return', qty: 1,
            restock: !damaged, refund_uzs: Math.round(revenue / qty), commission_refund_uzs: Math.round(commission / qty),
            return_logistics_uzs: 7_500, compensation_uzs: damaged ? 20_000 : 0,
            note: damaged ? 'Повреждение при доставке' : 'Возврат покупателем', created_at: at(rdate, 30),
          })
          if (!damaged) {
            movements.push({
              id: uid(), product_id: p.id, batch_id: null, batch_item_id: null, sale_item_id: null, return_id: retId,
              movement_date: rdate, type: 'return', qty: 1, unit_cost_uzs: null, note: null, created_at: at(rdate, 31),
            })
            stockSim.set(p.id, (stockSim.get(p.id) ?? 0) + 1)
          }
        }
      }
    }
  }
  // списание бракованной единицы
  movements.push({
    id: uid(), product_id: products[4].id, batch_id: null, batch_item_id: null, sale_item_id: null, return_id: null,
    movement_date: iso(subDays(today, 15)), type: 'defect', qty: -4, unit_cost_uzs: null,
    note: 'Брак обнаружен при инвентаризации', created_at: at(iso(subDays(today, 15)), 40),
  })

  const ev = (name: string, cny: number, moq: number, price: number, monthly: number | null, def: number, budget: number | null, delivery: number) => ({
    id: uid(), name, supplier_price_cny: cny, moq, cny_rate: CNY, unit_weight_kg: 0.2, delivery_per_unit_uzs: delivery,
    sale_price_uzs: price, commission_pct: 10, selling_costs_per_unit_uzs: 9_000, monthly_sales: monthly,
    defect_return_pct: def, budget_uzs: budget, notes: 'Демо-оценка', is_demo: true, created_at: at(iso(today)),
  })
  const evaluations = [
    ev('Портативная колонка', 22, 200, 149_000, 45, 4, 20_000_000, 11_000),
    ev('Автомобильный держатель', 4.5, 500, 35_000, 90, 3, 10_000_000, 3_500),
    ev('Электрическая зубная щётка', 31, 300, 79_000, null, 6, 12_000_000, 6_000),
  ]

  return {
    suppliers, products, marketplace_fee_settings: fees, exchange_rates: rates, purchase_batches: batches,
    purchase_batch_items: items, expenses, payments, sales, sale_items: saleItems, returns,
    inventory_movements: movements, product_evaluations: evaluations,
  } as unknown as DemoRows
}

/** Порядок вставки с учётом внешних ключей. */
export const DEMO_INSERT_ORDER: TableName[] = [
  'suppliers', 'products', 'marketplace_fee_settings', 'exchange_rates', 'purchase_batches', 'purchase_batch_items',
  'expenses', 'payments', 'sales', 'sale_items', 'returns', 'inventory_movements', 'product_evaluations',
]

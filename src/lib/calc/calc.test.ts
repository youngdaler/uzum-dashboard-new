import { describe, expect, it } from 'vitest'
import { calcBatch } from '@/lib/calc/batch'
import { calculate, DEFAULT_CALCULATOR, reversePrice, sensitivity } from '@/lib/calc/calculator'
import { derive } from '@/lib/calc/derive'
import { evaluate } from '@/lib/calc/evaluate'
import { periodMetrics, snapshot } from '@/lib/calc/finance'
import { breakEvenUnits, priceForMargin, unitEconomics } from '@/lib/calc/unit'
import { allocate, D, sum, toUzs } from '@/lib/money'
import {
  emptyDb,
  type Category,
  type Db,
  type Expense,
  type InventoryMovement,
  type Product,
  type ProductEvaluation,
  type PurchaseBatch,
  type PurchaseBatchItem,
  type Sale,
  type SaleItem,
} from '@/types/db'

// ---------------------------------------------------------------------------
// Фабрики тестовых данных
// ---------------------------------------------------------------------------
const U = 'u1'
let seq = 0
const id = (p: string) => `${p}-${++seq}`
const ts = () => `2026-01-01T00:00:${String(++seq % 60).padStart(2, '0')}Z`

const cat = (code: string, cost_type: 'landed' | 'operating'): Category => ({
  id: `cat-${code}`,
  user_id: U,
  created_at: ts(),
  kind: 'expense',
  code,
  name: code,
  cost_type,
  is_demo: false,
})

const product = (over: Partial<Product> = {}): Product => ({
  id: id('p'),
  user_id: U,
  created_at: ts(),
  name: 'Товар',
  sku: id('sku'),
  barcode: null,
  category_id: null,
  photo_url: null,
  source_url: null,
  supplier_id: null,
  purchase_price_cny: 0,
  recommended_price_uzs: 0,
  sale_price_uzs: 0,
  commission_pct: null,
  packaging_cost_uzs: 0,
  extra_cost_uzs: 0,
  weight_kg: 0,
  volume_m3: 0,
  min_stock: 0,
  expected_monthly_sales: null,
  status: 'active',
  is_demo: false,
  ...over,
})

const batch = (over: Partial<PurchaseBatch> = {}): PurchaseBatch => ({
  id: id('b'),
  user_id: U,
  created_at: ts(),
  batch_no: 'B-1',
  order_date: '2026-01-01',
  received_date: '2026-01-20',
  supplier_id: null,
  order_url: null,
  status: 'received',
  cny_rate: 1800,
  prepayment_cny: 0,
  allocation_method: 'quantity',
  actual_weight_kg: 0,
  volume_m3: 0,
  cargo_tariff_kg: 0,
  cargo_tariff_m3: 0,
  cargo_currency: 'USD',
  notes: null,
  is_demo: false,
  ...over,
})

const item = (b: PurchaseBatch, p: Product, over: Partial<PurchaseBatchItem> = {}): PurchaseBatchItem => ({
  id: id('bi'),
  user_id: U,
  created_at: ts(),
  batch_id: b.id,
  product_id: p.id,
  qty_ordered: 100,
  qty_received: 100,
  qty_defective: 0,
  unit_price_cny: 10,
  unit_weight_kg: 0,
  unit_volume_m3: 0,
  planned_sale_price_uzs: 0,
  ...over,
})

const expense = (c: Category, over: Partial<Expense> = {}): Expense => {
  const amount = over.amount ?? 1000
  return {
    id: id('e'),
    user_id: U,
    created_at: ts(),
    expense_date: '2026-01-10',
    category_id: c.id,
    amount,
    currency: 'UZS',
    rate_to_uzs: 1,
    amount_uzs: amount,
    scope: 'operating',
    batch_id: null,
    batch_item_id: null,
    allocation_method: null,
    payment_method: 'cash',
    payment_status: 'paid',
    due_date: null,
    comment: null,
    is_demo: false,
    ...over,
  }
}

const receipt = (b: PurchaseBatch, it: PurchaseBatchItem, date: string, qty = it.qty_received - it.qty_defective): InventoryMovement => ({
  id: id('m'),
  user_id: U,
  created_at: ts(),
  product_id: it.product_id,
  batch_id: b.id,
  batch_item_id: it.id,
  sale_item_id: null,
  return_id: null,
  movement_date: date,
  type: 'receipt',
  qty,
  unit_cost_uzs: null,
  note: null,
})

function saleWith(
  p: Product,
  qty: number,
  date: string,
  over: Partial<SaleItem> = {},
  saleOver: Partial<Sale> = {},
): { sale: Sale; item: SaleItem; movement: InventoryMovement | null } {
  const sale: Sale = {
    id: id('s'),
    user_id: U,
    created_at: ts(),
    order_no: id('ORD'),
    sale_date: date,
    status: 'completed',
    payout_actual_uzs: null,
    payout_received_date: null,
    notes: null,
    is_demo: false,
    ...saleOver,
  }
  const si: SaleItem = {
    id: id('si'),
    user_id: U,
    created_at: ts(),
    sale_id: sale.id,
    product_id: p.id,
    qty,
    unit_price_uzs: 100_000,
    seller_discount_uzs: 0,
    commission_uzs: 0,
    commission_pct: null,
    logistics_uzs: 0,
    ads_uzs: 0,
    other_deductions_uzs: 0,
    packaging_uzs: 0,
    extra_cost_uzs: 0,
    ...over,
  }
  const movement: InventoryMovement | null =
    sale.status === 'completed'
      ? {
          id: id('m'),
          user_id: U,
          created_at: ts(),
          product_id: p.id,
          batch_id: null,
          batch_item_id: null,
          sale_item_id: si.id,
          return_id: null,
          movement_date: date,
          type: 'sale',
          qty: -qty,
          unit_cost_uzs: null,
          note: null,
        }
      : null
  return { sale, item: si, movement }
}

// ---------------------------------------------------------------------------
// Деньги и округление
// ---------------------------------------------------------------------------
describe('money', () => {
  it('распределение по весам: сумма долей всегда равна сумме', () => {
    const shares = allocate(100, [1, 1, 1])
    expect(sum(shares).toString()).toBe('100')
    expect(shares.map((s) => s.toString())).toEqual(['33.34', '33.33', '33.33'])
    const odd = allocate('1000.01', [3, 5, 7, 11])
    expect(sum(odd).toString()).toBe('1000.01')
  })

  it('нулевые веса — равное распределение', () => {
    const shares = allocate(10, [0, 0])
    expect(shares.map((s) => s.toString())).toEqual(['5', '5'])
  })

  it('пересчёт валют фиксирует курс и округляет до 2 знаков half-up', () => {
    expect(toUzs(10, 'CNY', 1789.456789).toString()).toBe('17894.57')
    expect(toUzs(5, 'UZS', 1).toString()).toBe('5')
    expect(D(0.1).plus(0.2).toString()).toBe('0.3') // нет float-ошибок
  })
})

// ---------------------------------------------------------------------------
// Экономика единицы
// ---------------------------------------------------------------------------
describe('unitEconomics', () => {
  it('считает выплату, прибыль, маржу, наценку и ROI по формулам ТЗ', () => {
    const r = unitEconomics({
      price: 100_000,
      discount: 10_000,
      commissionPct: 10,
      logistics: 5_000,
      packaging: 2_000,
      ads: 3_000,
      unitCost: 50_000,
    })
    expect(r.revenue.toString()).toBe('90000')
    expect(r.commission.toString()).toBe('9000')
    expect(r.payout.toString()).toBe('76000') // 90000 − 9000 − 5000
    expect(r.profit.toString()).toBe('21000') // 76000 − 5000 − 50000
    expect(r.marginPct!.toFixed(2)).toBe('23.33') // 21000 / 90000
    expect(r.markupPct!.toFixed(2)).toBe('42.00') // 21000 / 50000
    expect(r.roiPct!.toFixed(2)).toBe('38.18') // 21000 / (50000 + 5000)
  })

  it('точка безубыточности: ceil(вложения / вклад), null при неположительном вкладе', () => {
    expect(breakEvenUnits(1_000_000, 30_000)).toBe(34)
    expect(breakEvenUnits(1_000_000, 0)).toBeNull()
    expect(breakEvenUnits(1_000_000, -5)).toBeNull()
    expect(breakEvenUnits(0, 100)).toBe(0)
  })

  it('обратный расчёт: цена из маржи даёт ту же маржу при прямом расчёте', () => {
    const base = { commissionPct: 12, logistics: 6_000, packaging: 1_500, unitCost: 45_000, discount: 0 }
    const price = priceForMargin(25, base)!
    const r = unitEconomics({ ...base, price })
    expect(r.marginPct!.toNumber()).toBeCloseTo(25, 2)
  })
})

// ---------------------------------------------------------------------------
// Партии
// ---------------------------------------------------------------------------
describe('calcBatch', () => {
  const cargo = cat('cargo', 'landed')
  const customs = cat('customs', 'landed')
  const categories = new Map([cargo, customs].map((c) => [c.id, c]))

  it('распределяет расходы по весу, не теряет и не дублирует ни сума', () => {
    const p1 = product()
    const p2 = product()
    const b = batch({ allocation_method: 'weight' })
    const i1 = item(b, p1, { qty_ordered: 100, qty_received: 100, unit_price_cny: 10, unit_weight_kg: 1 })
    const i2 = item(b, p2, { qty_ordered: 50, qty_received: 50, unit_price_cny: 20, unit_weight_kg: 3 })
    const e1 = expense(cargo, { amount: 1_000_000, scope: 'batch', batch_id: b.id })
    const e2 = expense(customs, { amount: 333_333, scope: 'item', batch_id: b.id, batch_item_id: i1.id })
    const c = calcBatch({ batch: b, items: [i1, i2], expenses: [e1, e2], categories, payments: [] })

    // товар: 100×10×1800 + 50×20×1800 = 1 800 000 + 1 800 000
    expect(c.goodsUzs.toString()).toBe('3600000')
    // веса: 100 кг и 150 кг → 400 000 / 600 000
    const a1 = c.items.find((x) => x.item_id === i1.id)!
    const a2 = c.items.find((x) => x.item_id === i2.id)!
    expect(a1.allocatedUzs.toString()).toBe('733333') // 400 000 + 333 333
    expect(a2.allocatedUzs.toString()).toBe('600000')
    // итог = товар + все расходы, ровно один раз
    expect(c.totalCostUzs.toString()).toBe(D(3_600_000).plus(1_000_000).plus(333_333).toString())
    expect(sum(c.items.map((x) => x.totalUzs)).toString()).toBe(c.totalCostUzs.toString())
    // аллокации по каждому расходу в сумме равны расходу
    for (const e of [e1, e2]) {
      const s = sum(c.allocations.filter((a) => a.expense_id === e.id).map((a) => a.amount_uzs))
      expect(s.toString()).toBe(D(e.amount_uzs).toString())
    }
    // логистика и «прочие» разделены
    expect(c.logisticsUzs.toString()).toBe('1000000')
    expect(c.otherExtrasUzs.toString()).toBe('333333')
  })

  it('себестоимость единицы делится на годные единицы (получено − брак)', () => {
    const p = product()
    const b = batch()
    const it = item(b, p, { qty_ordered: 100, qty_received: 98, qty_defective: 8, unit_price_cny: 10 })
    const c = calcBatch({ batch: b, items: [it], expenses: [], categories, payments: [] })
    expect(c.qtyAvailable).toBe(90)
    expect(c.unitCostAvgUzs!.toString()).toBe('20000') // 1 800 000 / 90
  })

  it('без данных веса распределение откатывается к стоимости с предупреждением', () => {
    const b = batch({ allocation_method: 'weight' })
    const p1 = product()
    const p2 = product()
    const i1 = item(b, p1, { unit_price_cny: 10 })
    const i2 = item(b, p2, { unit_price_cny: 30 })
    const e = expense(cargo, { amount: 400, scope: 'batch', batch_id: b.id })
    const c = calcBatch({ batch: b, items: [i1, i2], expenses: [e], categories, payments: [] })
    expect(c.items[0].allocatedUzs.toString()).toBe('100')
    expect(c.items[1].allocatedUzs.toString()).toBe('300')
    expect(c.warnings.some((w) => w.includes('вес'))).toBe(true)
  })

  it('задолженность поставщику = стоимость товара − предоплата − оплаты', () => {
    const p = product()
    const b = batch({ prepayment_cny: 400 })
    const it = item(b, p, { unit_price_cny: 10, qty_ordered: 100 }) // 1000 CNY
    const c = calcBatch({
      batch: b,
      items: [it],
      expenses: [],
      categories,
      payments: [
        {
          id: 'pay1', user_id: U, created_at: ts(), kind: 'supplier', payment_date: '2026-01-15', due_date: null,
          status: 'paid', batch_id: b.id, amount: 100, currency: 'CNY', rate_to_uzs: 1800, amount_uzs: 180000,
          note: null, is_demo: false,
        },
      ],
    })
    expect(c.debtCny.toString()).toBe('500')
    expect(c.debtUzs.toString()).toBe('900000')
  })
})

// ---------------------------------------------------------------------------
// Склад и финансы
// ---------------------------------------------------------------------------
describe('склад: FIFO и средневзвешенная', () => {
  function scenario(method: 'fifo' | 'wac'): Db {
    const db = emptyDb()
    const p = product()
    const b1 = batch({ batch_no: 'A', cny_rate: 1000 })
    const b2 = batch({ batch_no: 'B', cny_rate: 1000 })
    const i1 = item(b1, p, { qty_ordered: 10, qty_received: 10, unit_price_cny: 10 }) // 100 000 / 10 = 10 000
    const i2 = item(b2, p, { qty_ordered: 10, qty_received: 10, unit_price_cny: 20 }) // 200 000 / 10 = 20 000
    const s = saleWith(p, 15, '2026-02-10')
    db.profile = {
      id: U, full_name: '', business_name: '', base_currency: 'UZS', language: 'ru', cost_method: method,
      tax_mode: 'estimate', tax_rate_pct: 0, tax_base: 'revenue', default_min_stock: 0, export_format: 'csv',
      created_at: ts(), updated_at: ts(),
    }
    db.products = [p]
    db.purchase_batches = [b1, b2]
    db.purchase_batch_items = [i1, i2]
    db.inventory_movements = [receipt(b1, i1, '2026-01-10'), receipt(b2, i2, '2026-01-20'), s.movement!]
    db.sales = [s.sale]
    db.sale_items = [s.item]
    return db
  }

  it('FIFO: сначала продаётся дешёвая партия', () => {
    const d = derive(scenario('fifo'))
    const cogs = [...d.inventory.cogsBySaleItem.values()][0]
    expect(cogs.toString()).toBe('200000') // 10×10 000 + 5×20 000
    expect(d.inventory.totalValue.toString()).toBe('100000') // 5×20 000
  })

  it('средневзвешенная: единая средняя стоимость', () => {
    const d = derive(scenario('wac'))
    const cogs = [...d.inventory.cogsBySaleItem.values()][0]
    expect(cogs.toString()).toBe('225000') // 15 × 15 000
    expect(d.inventory.totalValue.toString()).toBe('75000')
  })

  it('стоимость закупки = себестоимость проданного + стоимость остатка (ничего не теряется)', () => {
    for (const m of ['fifo', 'wac'] as const) {
      const d = derive(scenario(m))
      const cogs = [...d.inventory.cogsBySaleItem.values()][0]
      expect(cogs.plus(d.inventory.totalValue).toString()).toBe('300000')
    }
  })

  it('FIFO-привязка к партиям для отчёта по партиям', () => {
    const d = derive(scenario('wac'))
    const bySold = new Map<string | null, number>()
    for (const a of d.inventory.attribution) bySold.set(a.batchId, (bySold.get(a.batchId) ?? 0) + a.qty)
    const [bA, bB] = [...d.batchCalcs.keys()]
    expect(bySold.get(bA)).toBe(10)
    expect(bySold.get(bB)).toBe(5)
  })
})

describe('финансы периода', () => {
  const cargo = cat('cargo', 'landed')
  const adv = cat('advertising', 'operating')
  const taxes = cat('taxes', 'operating')

  function base(): { db: Db; p: Product } {
    const db = emptyDb()
    const p = product()
    const b = batch({ cny_rate: 1000, received_date: '2026-01-05' })
    const it = item(b, p, { qty_ordered: 100, qty_received: 100, unit_price_cny: 50 }) // товар 5 000 000
    db.profile = {
      id: U, full_name: '', business_name: '', base_currency: 'UZS', language: 'ru', cost_method: 'wac',
      tax_mode: 'estimate', tax_rate_pct: 0, tax_base: 'revenue', default_min_stock: 0, export_format: 'csv',
      created_at: ts(), updated_at: ts(),
    }
    db.categories = [cargo, adv, taxes]
    db.products = [p]
    db.purchase_batches = [b]
    db.purchase_batch_items = [it]
    db.expenses = [expense(cargo, { amount: 1_000_000, scope: 'batch', batch_id: b.id })]
    db.inventory_movements = [receipt(b, it, '2026-01-05')]
    return { db, p }
  }

  it('прибыль считается по проданным единицам, а не по всей закупке; остаток остаётся в запасах', () => {
    const { db, p } = base()
    const s = saleWith(p, 20, '2026-02-01', { commission_uzs: 200_000, logistics_uzs: 100_000 })
    db.sales = [s.sale]
    db.sale_items = [s.item]
    db.inventory_movements.push(s.movement!)
    const d = derive(db)
    const m = periodMetrics(d.finance, { from: '2026-02-01', to: '2026-02-28' })
    // себестоимость единицы = (5 000 000 + 1 000 000) / 100 = 60 000
    expect(m.revenue.toString()).toBe('2000000')
    expect(m.cogs.toString()).toBe('1200000')
    expect(m.grossProfit.toString()).toBe('800000')
    expect(m.sellingCosts.toString()).toBe('300000') // комиссия + логистика, один раз
    expect(m.operatingProfit.toString()).toBe('500000')
    expect(m.netProfit.toString()).toBe('500000')
    // карго партии (операционным расходом периода не является) не вычитается второй раз
    expect(m.opex.toString()).toBe('0')
    // остаток: 80 ед. × 60 000
    expect(snapshot(d.finance).inventoryValue.toString()).toBe('4800000')
  })

  it('отменённый заказ и заказ в работе не признаются продажей', () => {
    const { db, p } = base()
    const done = saleWith(p, 10, '2026-02-01')
    const cancelled = saleWith(p, 5, '2026-02-02', {}, { status: 'cancelled' })
    const inProgress = saleWith(p, 7, '2026-02-03', {}, { status: 'in_progress' })
    db.sales = [done.sale, cancelled.sale, inProgress.sale]
    db.sale_items = [done.item, cancelled.item, inProgress.item]
    db.inventory_movements.push(done.movement!)
    const d = derive(db)
    const m = periodMetrics(d.finance, { from: '2026-02-01', to: '2026-02-28' })
    expect(m.revenue.toString()).toBe('1000000')
    expect(m.unitsSold).toBe(10)
    expect(m.cancelledOrders).toBe(1)
    const st = d.inventory.byProduct.get(p.id)!
    expect(st.stock).toBe(90)
    expect(st.reserved).toBe(7)
    expect(st.available).toBe(83)
  })

  it('операционные расходы и расчётный налог; фактический налог не дублирует расчётный', () => {
    const { db, p } = base()
    const s = saleWith(p, 10, '2026-02-01')
    db.sales = [s.sale]
    db.sale_items = [s.item]
    db.inventory_movements.push(s.movement!)
    db.expenses.push(expense(adv, { amount: 100_000, expense_date: '2026-02-05' }))
    db.expenses.push(expense(taxes, { amount: 50_000, expense_date: '2026-02-06' }))
    db.profile!.tax_rate_pct = 4
    db.profile!.tax_base = 'revenue'

    let m = periodMetrics(derive(db).finance, { from: '2026-02-01', to: '2026-02-28' })
    // выручка 1 000 000; расчётный налог 4% = 40 000; фактический налог-расход не вычитается
    expect(m.tax.toString()).toBe('40000')
    expect(m.opex.toString()).toBe('100000')

    db.profile!.tax_mode = 'actual'
    m = periodMetrics(derive(db).finance, { from: '2026-02-01', to: '2026-02-28' })
    expect(m.tax.toString()).toBe('50000')
  })

  it('возврат с повторным оприходованием возвращает выручку и себестоимость; брак — убыток', () => {
    const { db, p } = base()
    const s = saleWith(p, 10, '2026-02-01')
    db.sales = [s.sale]
    db.sale_items = [s.item]
    db.inventory_movements.push(s.movement!)
    const ret = {
      id: 'ret1', user_id: U, created_at: ts(), sale_item_id: s.item.id, return_date: '2026-02-10',
      kind: 'return' as const, qty: 2, restock: true, refund_uzs: 200_000, commission_refund_uzs: 0,
      return_logistics_uzs: 10_000, compensation_uzs: 0, note: null,
    }
    db.returns = [ret]
    db.inventory_movements.push({
      id: 'mret', user_id: U, created_at: ts(), product_id: p.id, batch_id: null, batch_item_id: null,
      sale_item_id: null, return_id: 'ret1', movement_date: '2026-02-10', type: 'return', qty: 2,
      unit_cost_uzs: null, note: null,
    })
    const d = derive(db)
    const m = periodMetrics(d.finance, { from: '2026-02-01', to: '2026-02-28' })
    expect(m.revenue.toString()).toBe('800000')
    expect(m.cogs.toString()).toBe('480000') // 8 ед. × 60 000
    expect(m.returnLogistics.toString()).toBe('10000')
    expect(m.unitsSold).toBe(8)
    expect(d.inventory.byProduct.get(p.id)!.stock).toBe(92)
  })

  it('дебиторка: завершённые, но не выплаченные Uzum заказы', () => {
    const { db, p } = base()
    const s1 = saleWith(p, 10, '2026-02-01', { commission_uzs: 100_000 }, { payout_received_date: '2026-02-08' })
    const s2 = saleWith(p, 5, '2026-02-02', { commission_uzs: 50_000 })
    db.sales = [s1.sale, s2.sale]
    db.sale_items = [s1.item, s2.item]
    db.inventory_movements.push(s1.movement!, s2.movement!)
    const d = derive(db)
    const snap = snapshot(d.finance)
    expect(snap.receivable.toString()).toBe('450000') // 500 000 − 50 000
    const m = periodMetrics(d.finance, { from: '2026-02-01', to: '2026-02-28' })
    expect(m.cashIn.toString()).toBe('900000') // только выплаченный заказ: 1 000 000 − 100 000
  })
})

// ---------------------------------------------------------------------------
// Калькулятор и оценка закупки
// ---------------------------------------------------------------------------
describe('калькулятор себестоимости', () => {
  const input = {
    ...DEFAULT_CALCULATOR,
    purchasePriceCny: 20,
    qty: 200,
    cnyRate: 1800,
    usdRate: 12700,
    unitWeightKg: 0.5,
    cargoRate: 4,
    cargoCurrency: 'USD' as const,
    extraBatchCostsUzs: 400_000,
    plannedPrice: 120_000,
    commissionPct: 10,
    logisticsPerUnit: 6_000,
    packagingPerUnit: 1_000,
    adsMode: 'per_batch' as const,
    adsAmount: 200_000,
  }

  it('считает себестоимость и прибыль партии; 100% сценарий = прибыль на единицу × количество', () => {
    const r = calculate(input)
    expect(r.purchasePerUnit.toString()).toBe('36000')
    expect(r.cargoPerUnit.toString()).toBe('25400') // 0.5 кг × 4 $ × 12 700
    expect(r.unitCost.toString()).toBe('63400') // 36 000 + 25 400 + 2 000
    expect(r.totalCost.toString()).toBe('12680000')
    const full = r.scenarios.find((s) => s.pct === 100)!
    expect(full.profit.toString()).toBe(r.profitPerUnit.mul(200).toString())
    // при продаже 25% партии — убыток, при 100% — прибыль
    expect(r.scenarios[0].profit.lt(0)).toBe(true)
    expect(full.profit.gt(0)).toBe(true)
    expect(r.breakEvenUnits).not.toBeNull()
    expect(r.breakEvenUnits!).toBeLessThan(200)
  })

  it('обратный расчёт цены под желаемую маржинальность', () => {
    const price = reversePrice(input, 'margin', 20)!
    const r = calculate({ ...input, plannedPrice: price.toNumber() })
    expect(r.marginPct!.toNumber()).toBeCloseTo(20, 1)
  })

  it('чувствительность: рост курса снижает прибыль, рост цены повышает', () => {
    const byRate = sensitivity(input, 'rate', [-10, 0, 10])
    expect(byRate[0].profitPerUnit.gt(byRate[2].profitPerUnit)).toBe(true)
    const byPrice = sensitivity(input, 'price', [-10, 0, 10])
    expect(byPrice[2].profitPerUnit.gt(byPrice[0].profitPerUnit)).toBe(true)
  })
})

describe('оценка закупки', () => {
  const base: ProductEvaluation = {
    id: 'ev', user_id: U, created_at: ts(), updated_at: ts(), name: 'Тест', supplier_price_cny: 20, moq: 100,
    cny_rate: 1800, unit_weight_kg: 0.3, delivery_per_unit_uzs: 9_000, sale_price_uzs: 120_000,
    commission_pct: 10, selling_costs_per_unit_uzs: 8_000, monthly_sales: 40, defect_return_pct: 5,
    budget_uzs: 10_000_000, notes: null, is_demo: false,
  }

  it('считает прибыль, ROI и сроки; прибыльный товар без предупреждений об убытке', () => {
    const r = evaluate(base)
    expect(r.capital.toString()).toBe('4500000') // 100 × 36 000 + 100 × 9 000
    expect(r.sellableQty).toBe(95)
    expect(r.netProfit.gt(0)).toBe(true)
    expect(r.monthsToSell!.toNumber()).toBeCloseTo(2.375, 3)
    expect(r.warnings.some((w) => w.includes('убыточен'))).toBe(false)
    expect(r.reliable).toBe(true)
  })

  it('предупреждает об убытке, превышении бюджета и нехватке данных', () => {
    const r = evaluate({ ...base, sale_price_uzs: 50_000, budget_uzs: 1_000_000, monthly_sales: null })
    expect(r.warnings.some((w) => w.includes('убыточен'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('бюджет'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('Недостаточно данных'))).toBe(true)
    expect(r.reliable).toBe(false)
  })
})

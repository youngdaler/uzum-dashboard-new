import {
  addDays,
  eachDayOfInterval,
  eachMonthOfInterval,
  eachWeekOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
} from 'date-fns'
import { LOGISTICS_CODES, TAX_CODE } from '@/lib/constants'
import { D, Decimal, pctOf, roundUzs, sum } from '@/lib/money'
import type { BatchCalc } from '@/lib/calc/batch'
import type { InventoryResult } from '@/lib/calc/inventory'
import type { Category, Db, Profile } from '@/types/db'

/**
 * Финансовое ядро. Разделяет показатели, которые нельзя смешивать:
 *   выручка · валовая прибыль · операционная прибыль · чистая прибыль ·
 *   денежный поток · дебиторка · кредиторка · вложенный капитал · стоимость запасов.
 *
 * Принципы:
 *  - прибыль считается по проданным единицам (себестоимость реализованных), а не по стоимости
 *    всей закупки; непроданные товары остаются в запасах;
 *  - расходы партии (landed) входят в себестоимость единиц и НЕ попадают в расходы периода
 *    второй раз; в расходы периода попадают только операционные расходы (scope = operating);
 *  - комиссия/логистика Uzum берутся только из строк продаж (не из журнала расходов);
 *  - отменённые заказы — не продажи; заказы «в работе» — резерв, не выручка;
 *  - налог: расчётный (ставка × база) либо фактический (расходы категории «Налоги») — не оба сразу.
 */

export interface SaleLine {
  saleItemId: string
  saleId: string
  orderNo: string
  date: string
  productId: string
  qty: number
  gross: Decimal
  discount: Decimal
  revenue: Decimal
  commission: Decimal
  logistics: Decimal
  otherDeductions: Decimal
  ads: Decimal
  packaging: Decimal
  extra: Decimal
  cogs: Decimal
  expectedPayout: Decimal
}

export interface ReturnLine {
  returnId: string
  saleItemId: string
  productId: string
  date: string
  kind: 'return' | 'damaged'
  qty: number
  restock: boolean
  refund: Decimal
  commissionRefund: Decimal
  returnLogistics: Decimal
  compensation: Decimal
  costReversal: Decimal
}

export interface OrderPayout {
  saleId: string
  orderNo: string
  date: string
  receivedDate: string | null
  expected: Decimal
  amount: Decimal
}

export interface OpexLine {
  id: string
  date: string
  code: string
  categoryName: string
  amount: Decimal
  paid: boolean
}

export interface FinanceContext {
  lines: SaleLine[]
  returns: ReturnLine[]
  payouts: OrderPayout[]
  opex: OpexLine[] // операционные расходы без налогов
  taxExpenses: OpexLine[]
  landedExpenses: OpexLine[]
  losses: { date: string; value: Decimal }[]
  batchPurchases: { date: string; goods: Decimal }[]
  cancelledOrders: { date: string }[]
  profile: Pick<Profile, 'tax_mode' | 'tax_rate_pct' | 'tax_base'>
  db: Db
  batchCalcs: Map<string, BatchCalc>
  inventory: InventoryResult
}

export interface DateRange {
  from: string
  to: string
}

const inRange = (d: string, r: DateRange): boolean => d >= r.from && d <= r.to

export function buildFinanceContext(args: {
  db: Db
  batchCalcs: Map<string, BatchCalc>
  inventory: InventoryResult
  categories: Map<string, Category>
}): FinanceContext {
  const { db, batchCalcs, inventory, categories } = args
  const saleById = new Map(db.sales.map((s) => [s.id, s]))
  const itemById = new Map(db.sale_items.map((s) => [s.id, s]))

  const lines: SaleLine[] = []
  for (const it of db.sale_items) {
    const sale = saleById.get(it.sale_id)
    if (!sale || sale.status !== 'completed') continue
    const gross = D(it.unit_price_uzs).mul(it.qty)
    const discount = D(it.seller_discount_uzs)
    const revenue = gross.minus(discount)
    const commission = D(it.commission_uzs)
    const logistics = D(it.logistics_uzs)
    const other = D(it.other_deductions_uzs)
    lines.push({
      saleItemId: it.id,
      saleId: sale.id,
      orderNo: sale.order_no,
      date: sale.sale_date,
      productId: it.product_id,
      qty: it.qty,
      gross,
      discount,
      revenue,
      commission,
      logistics,
      otherDeductions: other,
      ads: D(it.ads_uzs),
      packaging: D(it.packaging_uzs),
      extra: D(it.extra_cost_uzs),
      cogs: inventory.cogsBySaleItem.get(it.id) ?? new Decimal(0),
      expectedPayout: revenue.minus(commission).minus(logistics).minus(other),
    })
  }

  const returns = db.returns.map((r) => {
    const it = itemById.get(r.sale_item_id)
    return {
      returnId: r.id,
      saleItemId: r.sale_item_id,
      productId: it?.product_id ?? '',
      date: r.return_date,
      kind: r.kind,
      qty: r.qty,
      restock: r.restock,
      refund: D(r.refund_uzs),
      commissionRefund: D(r.commission_refund_uzs),
      returnLogistics: D(r.return_logistics_uzs),
      compensation: D(r.compensation_uzs),
      costReversal: r.restock ? (inventory.returnCostByReturn.get(r.id) ?? new Decimal(0)) : new Decimal(0),
    } satisfies ReturnLine
  })

  const byOrder = new Map<string, OrderPayout>()
  for (const l of lines) {
    const sale = saleById.get(l.saleId)!
    const cur = byOrder.get(l.saleId) ?? {
      saleId: l.saleId,
      orderNo: l.orderNo,
      date: l.date,
      receivedDate: sale.payout_received_date,
      expected: new Decimal(0),
      amount: new Decimal(0),
    }
    cur.expected = cur.expected.plus(l.expectedPayout)
    byOrder.set(l.saleId, cur)
  }
  const payouts = [...byOrder.values()].map((p) => {
    const sale = saleById.get(p.saleId)!
    return { ...p, amount: sale.payout_actual_uzs !== null ? D(sale.payout_actual_uzs) : p.expected }
  })

  const opex: OpexLine[] = []
  const taxExpenses: OpexLine[] = []
  const landedExpenses: OpexLine[] = []
  for (const e of db.expenses) {
    const cat = categories.get(e.category_id)
    const line: OpexLine = {
      id: e.id,
      date: e.expense_date,
      code: cat?.code ?? 'other',
      categoryName: cat?.name ?? 'Прочее',
      amount: D(e.amount_uzs),
      paid: e.payment_status === 'paid',
    }
    if (e.scope === 'operating') {
      if (line.code === TAX_CODE) taxExpenses.push(line)
      else opex.push(line)
    } else landedExpenses.push(line)
  }

  const batchPurchases = db.purchase_batches.map((b) => ({
    date: b.order_date,
    goods: batchCalcs.get(b.id)?.goodsUzs ?? new Decimal(0),
  }))

  const cancelledOrders = db.sales.filter((s) => s.status === 'cancelled').map((s) => ({ date: s.sale_date }))

  return {
    lines,
    returns,
    payouts,
    opex,
    taxExpenses,
    landedExpenses,
    losses: inventory.losses.map((l) => ({ date: l.date, value: l.value })),
    batchPurchases,
    cancelledOrders,
    profile: {
      tax_mode: db.profile?.tax_mode ?? 'estimate',
      tax_rate_pct: db.profile?.tax_rate_pct ?? 0,
      tax_base: db.profile?.tax_base ?? 'revenue',
    },
    db,
    batchCalcs,
    inventory,
  }
}

export interface PeriodMetrics {
  range: DateRange
  unitsSold: number
  grossSales: Decimal
  discounts: Decimal
  refunds: Decimal
  revenue: Decimal
  cogs: Decimal
  grossProfit: Decimal
  commission: Decimal
  logisticsUzum: Decimal
  otherDeductions: Decimal
  ads: Decimal
  packaging: Decimal
  extra: Decimal
  returnLogistics: Decimal
  compensation: Decimal
  sellingCosts: Decimal
  opex: Decimal
  losses: Decimal
  operatingProfit: Decimal
  tax: Decimal
  netProfit: Decimal
  netMarginPct: Decimal | null
  cancelledOrders: number
  returnedUnits: number
  returnEvents: number
  orders: number
  cashIn: Decimal
  cashOut: Decimal
  netCash: Decimal
}

export function periodMetrics(ctx: FinanceContext, range: DateRange): PeriodMetrics {
  const lines = ctx.lines.filter((l) => inRange(l.date, range))
  const rets = ctx.returns.filter((r) => inRange(r.date, range))

  const grossSales = sum(lines.map((l) => l.gross))
  const discounts = sum(lines.map((l) => l.discount))
  const refunds = sum(rets.map((r) => r.refund))
  const revenue = grossSales.minus(discounts).minus(refunds)
  const cogs = sum(lines.map((l) => l.cogs)).minus(sum(rets.map((r) => r.costReversal)))
  const grossProfit = revenue.minus(cogs)

  const commission = sum(lines.map((l) => l.commission)).minus(sum(rets.map((r) => r.commissionRefund)))
  const logisticsUzum = sum(lines.map((l) => l.logistics))
  const otherDeductions = sum(lines.map((l) => l.otherDeductions))
  const ads = sum(lines.map((l) => l.ads))
  const packaging = sum(lines.map((l) => l.packaging))
  const extra = sum(lines.map((l) => l.extra))
  const returnLogistics = sum(rets.map((r) => r.returnLogistics))
  const compensation = sum(rets.map((r) => r.compensation))
  const sellingCosts = commission
    .plus(logisticsUzum)
    .plus(otherDeductions)
    .plus(ads)
    .plus(packaging)
    .plus(extra)
    .plus(returnLogistics)

  const opex = sum(ctx.opex.filter((e) => inRange(e.date, range)).map((e) => e.amount))
  const losses = sum(ctx.losses.filter((l) => inRange(l.date, range)).map((l) => l.value))
  const operatingProfit = grossProfit.minus(sellingCosts).plus(compensation).minus(opex).minus(losses)

  let tax = new Decimal(0)
  if (ctx.profile.tax_mode === 'actual') {
    tax = sum(ctx.taxExpenses.filter((e) => inRange(e.date, range)).map((e) => e.amount))
  } else {
    const base = ctx.profile.tax_base === 'revenue' ? revenue : operatingProfit
    tax = Decimal.max(base, 0).mul(D(ctx.profile.tax_rate_pct)).div(100)
  }
  tax = roundUzs(tax)
  const netProfit = operatingProfit.minus(tax)

  // Денежный поток (кассовый метод).
  const payoutsIn = sum(
    ctx.payouts.filter((p) => p.receivedDate !== null && inRange(p.receivedDate, range)).map((p) => p.amount),
  )
  const cashIn = payoutsIn.plus(compensation)

  const prepayOut = sum(
    ctx.db.purchase_batches
      .filter((b) => inRange(b.order_date, range))
      .map((b) => D(b.prepayment_cny).mul(D(b.cny_rate))),
  )
  const supplierOut = sum(
    ctx.db.payments
      .filter((p) => p.kind === 'supplier' && p.status === 'paid' && inRange(p.payment_date, range))
      .map((p) => p.amount_uzs),
  )
  const paidExpenses = sum(
    ctx.db.expenses.filter((e) => e.payment_status === 'paid' && inRange(e.expense_date, range)).map((e) => e.amount_uzs),
  )
  const saleLevelOut = ads.plus(packaging).plus(extra)
  const refundOut = sum(rets.map((r) => r.refund.minus(r.commissionRefund)))
  const cashOut = roundUzs(prepayOut).plus(supplierOut).plus(paidExpenses).plus(saleLevelOut).plus(refundOut).plus(returnLogistics)

  return {
    range,
    unitsSold: lines.reduce((s, l) => s + l.qty, 0) - rets.filter((r) => r.restock).reduce((s, r) => s + r.qty, 0),
    grossSales,
    discounts,
    refunds,
    revenue,
    cogs,
    grossProfit,
    commission,
    logisticsUzum,
    otherDeductions,
    ads,
    packaging,
    extra,
    returnLogistics,
    compensation,
    sellingCosts,
    opex,
    losses,
    operatingProfit,
    tax,
    netProfit,
    netMarginPct: pctOf(netProfit, revenue),
    cancelledOrders: ctx.cancelledOrders.filter((c) => inRange(c.date, range)).length,
    returnedUnits: rets.reduce((s, r) => s + r.qty, 0),
    returnEvents: rets.length,
    orders: new Set(lines.map((l) => l.saleId)).size,
    cashIn,
    cashOut,
    netCash: cashIn.minus(cashOut),
  }
}

export type Granularity = 'day' | 'week' | 'month'

export interface SeriesPoint {
  key: string
  label: string
  range: DateRange
  revenue: number
  grossProfit: number
  netProfit: number
  cashIn: number
  cashOut: number
}

export function buildSeries(ctx: FinanceContext, range: DateRange, g: Granularity): SeriesPoint[] {
  const start = parseISO(range.from)
  const end = parseISO(range.to)
  if (end < start) return []
  const buckets: { from: Date; to: Date; label: string }[] = []
  if (g === 'day') {
    for (const d of eachDayOfInterval({ start, end })) buckets.push({ from: d, to: d, label: format(d, 'dd.MM') })
  } else if (g === 'week') {
    for (const d of eachWeekOfInterval({ start, end }, { weekStartsOn: 1 }))
      buckets.push({ from: d, to: endOfWeek(d, { weekStartsOn: 1 }), label: format(d, 'dd.MM') })
  } else {
    for (const d of eachMonthOfInterval({ start, end })) buckets.push({ from: d, to: endOfMonth(d), label: format(d, 'MM.yyyy') })
  }
  const out: SeriesPoint[] = []
  for (const b of buckets) {
    const from = format(b.from < start ? start : b.from, 'yyyy-MM-dd')
    const to = format(b.to > end ? end : b.to, 'yyyy-MM-dd')
    const m = periodMetrics(ctx, { from, to })
    out.push({
      key: from,
      label: b.label,
      range: { from, to },
      revenue: m.revenue.toNumber(),
      grossProfit: m.grossProfit.toNumber(),
      netProfit: m.netProfit.toNumber(),
      cashIn: m.cashIn.toNumber(),
      cashOut: m.cashOut.toNumber(),
    })
  }
  return out
}

/** Рекомендуемая гранулярность по длине периода. */
export function defaultGranularity(range: DateRange): Granularity {
  const days = (parseISO(range.to).getTime() - parseISO(range.from).getTime()) / 86_400_000 + 1
  if (days <= 45) return 'day'
  if (days <= 200) return 'week'
  return 'month'
}

// ---------------------------------------------------------------------------
// Расходы по категориям (по дате возникновения)
// ---------------------------------------------------------------------------
export const EXPENSE_GROUPS = [
  'Закупка товара',
  'Карго и доставка',
  'Посредники и платежи',
  'Таможня и документы',
  'Комиссии и логистика Uzum',
  'Реклама',
  'Упаковка',
  'Налоги',
  'Прочее',
] as const
export type ExpenseGroup = (typeof EXPENSE_GROUPS)[number]

export function expenseGroupOf(code: string): ExpenseGroup {
  if (LOGISTICS_CODES.has(code)) return 'Карго и доставка'
  switch (code) {
    case 'intermediary':
    case 'payment_fee':
    case 'broker':
      return 'Посредники и платежи'
    case 'customs':
    case 'certification':
      return 'Таможня и документы'
    case 'marketplace_fee':
      return 'Комиссии и логистика Uzum'
    case 'advertising':
      return 'Реклама'
    case 'packaging':
    case 'packaging_marking':
      return 'Упаковка'
    case TAX_CODE:
      return 'Налоги'
    default:
      return 'Прочее'
  }
}

/** Расходы по группам за период: закупка — по дате заказа партии, остальное — по дате расхода/продажи. */
export function expensesByGroup(ctx: FinanceContext, range: DateRange): Record<ExpenseGroup, Decimal> {
  const acc = Object.fromEntries(EXPENSE_GROUPS.map((g) => [g, new Decimal(0)])) as Record<ExpenseGroup, Decimal>
  for (const b of ctx.batchPurchases) if (inRange(b.date, range)) acc['Закупка товара'] = acc['Закупка товара'].plus(b.goods)
  const add = (list: OpexLine[]) => {
    for (const e of list) if (inRange(e.date, range)) acc[expenseGroupOf(e.code)] = acc[expenseGroupOf(e.code)].plus(e.amount)
  }
  add(ctx.landedExpenses)
  add(ctx.opex)
  add(ctx.taxExpenses)
  const m = periodMetrics(ctx, range)
  acc['Комиссии и логистика Uzum'] = acc['Комиссии и логистика Uzum'].plus(m.commission).plus(m.logisticsUzum).plus(m.otherDeductions)
  acc['Реклама'] = acc['Реклама'].plus(m.ads)
  acc['Упаковка'] = acc['Упаковка'].plus(m.packaging)
  acc['Прочее'] = acc['Прочее'].plus(m.extra).plus(m.returnLogistics)
  if (ctx.profile.tax_mode === 'estimate') acc['Налоги'] = acc['Налоги'].plus(m.tax)
  return acc
}

// ---------------------------------------------------------------------------
// Отчёты по товарам и партиям
// ---------------------------------------------------------------------------
export interface ProductReportRow {
  productId: string
  units: number
  revenue: Decimal
  cogs: Decimal
  grossProfit: Decimal
  sellingCosts: Decimal
  /** Прибыль по товару до общих (непроизводственных) расходов. */
  contribution: Decimal
  marginPct: Decimal | null
}

export function productReport(ctx: FinanceContext, range: DateRange): ProductReportRow[] {
  const map = new Map<string, ProductReportRow>()
  const get = (id: string): ProductReportRow => {
    let r = map.get(id)
    if (!r) {
      r = {
        productId: id,
        units: 0,
        revenue: new Decimal(0),
        cogs: new Decimal(0),
        grossProfit: new Decimal(0),
        sellingCosts: new Decimal(0),
        contribution: new Decimal(0),
        marginPct: null,
      }
      map.set(id, r)
    }
    return r
  }
  for (const l of ctx.lines.filter((x) => inRange(x.date, range))) {
    const r = get(l.productId)
    r.units += l.qty
    r.revenue = r.revenue.plus(l.revenue)
    r.cogs = r.cogs.plus(l.cogs)
    r.sellingCosts = r.sellingCosts.plus(l.commission).plus(l.logistics).plus(l.otherDeductions).plus(l.ads).plus(l.packaging).plus(l.extra)
  }
  for (const x of ctx.returns.filter((y) => inRange(y.date, range) && y.productId)) {
    const r = get(x.productId)
    r.revenue = r.revenue.minus(x.refund)
    r.cogs = r.cogs.minus(x.costReversal)
    r.sellingCosts = r.sellingCosts.minus(x.commissionRefund).plus(x.returnLogistics).minus(x.compensation)
    if (x.restock) r.units -= x.qty
  }
  for (const r of map.values()) {
    r.grossProfit = r.revenue.minus(r.cogs)
    r.contribution = r.grossProfit.minus(r.sellingCosts)
    r.marginPct = pctOf(r.contribution, r.revenue)
  }
  return [...map.values()]
}

export interface BatchReportRow {
  batchId: string
  invested: Decimal
  qtyAvailable: number
  soldQty: number
  remainingQty: number
  revenue: Decimal
  costOfSold: Decimal
  sellingCosts: Decimal
  /** Фактический результат по реализованной части партии. */
  realizedProfit: Decimal
  /** Доля вложений, вернувшаяся выручкой за вычетом расходов на реализацию. */
  recoveredPct: Decimal | null
  plannedNetProfit: Decimal
  plannedRoiPct: Decimal | null
  breakEvenUnits: number | null
  paybackDays: number | null
}

/**
 * Отчёт по партиям. Проданные единицы привязываются к партиям по FIFO (самая ранняя партия
 * продаётся первой) — независимо от выбранного метода себестоимости. Результат — по
 * собственной себестоимости партии. Возврат на склад уменьшает проданное количество
 * партии первой привязки исходной продажи.
 */
export function batchReport(ctx: FinanceContext): BatchReportRow[] {
  const lineBySaleItem = new Map(ctx.lines.map((l) => [l.saleItemId, l]))
  const acc = new Map<string, { sold: number; revenue: Decimal; cost: Decimal; selling: Decimal }>()
  const getAcc = (id: string) => {
    let a = acc.get(id)
    if (!a) {
      a = { sold: 0, revenue: new Decimal(0), cost: new Decimal(0), selling: new Decimal(0) }
      acc.set(id, a)
    }
    return a
  }
  const productOfItem = new Map(ctx.db.sale_items.map((s) => [s.id, s.product_id]))
  const firstBatchOfSaleItem = new Map<string, string>()
  for (const a of ctx.inventory.attribution) {
    if (a.batchId && !firstBatchOfSaleItem.has(a.saleItemId)) firstBatchOfSaleItem.set(a.saleItemId, a.batchId)
    if (!a.batchId) continue
    const line = lineBySaleItem.get(a.saleItemId)
    if (!line || line.qty === 0) continue
    const share = D(a.qty).div(line.qty)
    const bc = ctx.batchCalcs.get(a.batchId)
    const unit = bc?.items.find((i) => i.product_id === productOfItem.get(a.saleItemId))?.unitCostUzs ?? null
    const x = getAcc(a.batchId)
    x.sold += a.qty
    x.revenue = x.revenue.plus(line.revenue.mul(share))
    x.cost = x.cost.plus(D(unit).mul(a.qty))
    x.selling = x.selling.plus(
      line.commission.plus(line.logistics).plus(line.otherDeductions).plus(line.ads).plus(line.packaging).plus(line.extra).mul(share),
    )
  }
  for (const r of ctx.returns) {
    const b = firstBatchOfSaleItem.get(r.saleItemId)
    if (!b) continue
    const x = getAcc(b)
    x.revenue = x.revenue.minus(r.refund)
    x.selling = x.selling.minus(r.commissionRefund).plus(r.returnLogistics)
    if (r.restock) {
      x.sold -= r.qty
      const bc = ctx.batchCalcs.get(b)
      const unit = bc?.items.find((i) => i.product_id === r.productId)?.unitCostUzs ?? null
      x.cost = x.cost.minus(D(unit).mul(r.qty))
    }
  }

  return ctx.db.purchase_batches.map((b) => {
    const calc = ctx.batchCalcs.get(b.id)!
    const a = acc.get(b.id) ?? { sold: 0, revenue: new Decimal(0), cost: new Decimal(0), selling: new Decimal(0) }
    return {
      batchId: b.id,
      invested: calc.totalCostUzs,
      qtyAvailable: calc.qtyAvailable,
      soldQty: a.sold,
      remainingQty: Math.max(calc.qtyAvailable - a.sold, 0),
      revenue: a.revenue,
      costOfSold: roundUzs(a.cost),
      sellingCosts: a.selling,
      realizedProfit: a.revenue.minus(roundUzs(a.cost)).minus(a.selling),
      recoveredPct: pctOf(a.revenue.minus(a.selling), calc.totalCostUzs),
      plannedNetProfit: calc.plannedNetProfit,
      plannedRoiPct: calc.roiPct,
      breakEvenUnits: calc.breakEvenUnits,
      paybackDays: calc.paybackDays,
    }
  })
}

// ---------------------------------------------------------------------------
// Снимок на текущий момент (не зависит от периода)
// ---------------------------------------------------------------------------
export interface Snapshot {
  inventoryValue: Decimal
  inventoryQty: number
  investedInPurchases: Decimal
  ownerCapital: Decimal
  /** Вложено в закупки минус полученные выплаты Uzum (не меньше нуля). */
  notYetReturned: Decimal
  receivable: Decimal
  payable: Decimal
  supplierDebt: Decimal
  pendingExpenses: Decimal
  activeBatches: number
}

export function snapshot(ctx: FinanceContext): Snapshot {
  const invested = sum([...ctx.batchCalcs.values()].map((b) => b.totalCostUzs))
  const received = sum(ctx.payouts.filter((p) => p.receivedDate !== null).map((p) => p.amount))
  const receivable = sum(ctx.payouts.filter((p) => p.receivedDate === null).map((p) => p.amount))
  const supplierDebt = sum([...ctx.batchCalcs.values()].map((b) => b.debtUzs))
  const pending = sum(ctx.db.expenses.filter((e) => e.payment_status === 'pending').map((e) => e.amount_uzs))
  const ownerIn = sum(ctx.db.payments.filter((p) => p.kind === 'owner_in' && p.status === 'paid').map((p) => p.amount_uzs))
  const ownerOut = sum(ctx.db.payments.filter((p) => p.kind === 'owner_out' && p.status === 'paid').map((p) => p.amount_uzs))
  return {
    inventoryValue: ctx.inventory.totalValue,
    inventoryQty: ctx.inventory.totalQty,
    investedInPurchases: invested,
    ownerCapital: ownerIn.minus(ownerOut),
    notYetReturned: Decimal.max(invested.minus(received), 0),
    receivable,
    payable: supplierDebt.plus(pending),
    supplierDebt,
    pendingExpenses: pending,
    activeBatches: ctx.db.purchase_batches.filter((b) => b.status !== 'closed').length,
  }
}

export function previousRange(r: DateRange): DateRange {
  const from = parseISO(r.from)
  const to = parseISO(r.to)
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
  return {
    from: format(addDays(from, -days), 'yyyy-MM-dd'),
    to: format(addDays(from, -1), 'yyyy-MM-dd'),
  }
}

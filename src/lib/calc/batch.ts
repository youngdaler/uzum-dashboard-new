import { LOGISTICS_CODES } from '@/lib/constants'
import { D, Decimal, allocate, pctOf, roundCost, roundUzs, sum, toUzs } from '@/lib/money'
import { breakEvenUnits, unitEconomics, type UnitInput } from '@/lib/calc/unit'
import type {
  AllocationMethod,
  Category,
  Expense,
  Payment,
  PurchaseBatch,
  PurchaseBatchItem,
} from '@/types/db'

/** Параметры реализации для плановых расчётов (комиссия, логистика Uzum и т.д. на единицу). */
export interface SellingParams {
  commissionPct: number
  logistics: number
  otherPct: number
  otherFixed: number
  packaging: number
  extra: number
  ads: number
}

export interface ItemCost {
  item_id: string
  product_id: string
  qtyOrdered: number
  qtyReceived: number
  qtyDefective: number
  /** Годные единицы, на которые делится стоимость: полученные − брак; до получения — заказанные. */
  qtyBasis: number
  isReceived: boolean
  goodsCny: Decimal
  goodsUzs: Decimal
  allocatedUzs: Decimal
  totalUzs: Decimal
  /** Полная себестоимость единицы (null, если нет годных единиц). */
  unitCostUzs: Decimal | null
  plannedPrice: Decimal
  plannedRevenue: Decimal
}

export interface AllocationRow {
  expense_id: string
  batch_item_id: string
  amount_uzs: Decimal
}

export interface BatchCalc {
  batchId: string
  items: ItemCost[]
  allocations: AllocationRow[]
  goodsCny: Decimal
  goodsUzs: Decimal
  logisticsUzs: Decimal
  otherExtrasUzs: Decimal
  extrasUzs: Decimal
  totalCostUzs: Decimal
  investedUzs: Decimal
  qtyOrdered: number
  qtyReceived: number
  qtyDefective: number
  qtyAvailable: number
  unitCostAvgUzs: Decimal | null
  plannedRevenue: Decimal
  plannedGrossProfit: Decimal
  plannedNetProfit: Decimal
  plannedSellingCosts: Decimal
  breakEvenUnits: number | null
  roiPct: Decimal | null
  paybackDays: number | null
  paidCny: Decimal
  debtCny: Decimal
  debtUzs: Decimal
  warnings: string[]
}

export interface BatchCalcInput {
  batch: PurchaseBatch
  items: PurchaseBatchItem[]
  /** Расходы, относящиеся к этой партии (scope batch/item). */
  expenses: Expense[]
  categories: Map<string, Category>
  payments: Payment[]
  /** Параметры реализации по позиции для плана; если не заданы — комиссия/логистика = 0. */
  sellingParams?: (item: PurchaseBatchItem) => SellingParams
  /** Ожидаемые продажи в месяц по позиции (для срока окупаемости). */
  monthlySales?: (item: PurchaseBatchItem) => number | null
}

const ZERO_SELLING: SellingParams = {
  commissionPct: 0,
  logistics: 0,
  otherPct: 0,
  otherFixed: 0,
  packaging: 0,
  extra: 0,
  ads: 0,
}

function itemQtyBasis(it: PurchaseBatchItem): number {
  return it.qty_received > 0 ? it.qty_received - it.qty_defective : it.qty_ordered
}

function weightOf(method: AllocationMethod, it: PurchaseBatchItem, goods: Decimal, qty: number): Decimal {
  switch (method) {
    case 'quantity':
      return D(qty)
    case 'value':
      return goods
    case 'weight':
      return D(it.unit_weight_kg).mul(qty)
    case 'volume':
      return D(it.unit_volume_m3).mul(qty)
  }
}

/**
 * Полный расчёт партии. Чистая функция: без обращения к БД, детерминирована.
 *
 *  - стоимость товара = Σ кол-во × цена CNY × курс партии (курс на момент закупки);
 *  - расход на конкретную позицию целиком относится к ней;
 *  - расход на всю партию распределяется выбранным методом (количество / стоимость / вес / объём);
 *    метод расхода может переопределять метод партии; если для метода нет данных
 *    (нулевой вес/объём у всех позиций) — используется стоимость и добавляется предупреждение;
 *  - сумма распределённых долей всегда равна сумме расхода (метод наибольшего остатка),
 *    поэтому расход учитывается ровно один раз.
 */
export function calcBatch(input: BatchCalcInput): BatchCalc {
  const { batch, items, expenses, categories, payments } = input
  const warnings: string[] = []
  const rate = D(batch.cny_rate)

  const base = items.map((it) => {
    const qtyBasis = itemQtyBasis(it)
    const goodsCny = D(it.unit_price_cny).mul(it.qty_ordered)
    const goodsUzs = roundUzs(goodsCny.mul(rate))
    return { it, qtyBasis, goodsCny, goodsUzs }
  })

  const allocations: AllocationRow[] = []
  const allocatedByItem = new Map<string, Decimal>(items.map((i) => [i.id, new Decimal(0)]))

  let logisticsUzs = new Decimal(0)
  let otherExtrasUzs = new Decimal(0)

  for (const e of expenses) {
    const amount = roundUzs(e.amount_uzs)
    const code = categories.get(e.category_id)?.code ?? ''
    if (LOGISTICS_CODES.has(code)) logisticsUzs = logisticsUzs.plus(amount)
    else otherExtrasUzs = otherExtrasUzs.plus(amount)

    if (e.scope === 'item' && e.batch_item_id) {
      if (!allocatedByItem.has(e.batch_item_id)) {
        warnings.push('Расход привязан к позиции, которой нет в партии.')
        continue
      }
      allocatedByItem.set(e.batch_item_id, allocatedByItem.get(e.batch_item_id)!.plus(amount))
      allocations.push({ expense_id: e.id, batch_item_id: e.batch_item_id, amount_uzs: amount })
      continue
    }

    if (base.length === 0) {
      warnings.push('В партии нет позиций — расходы не распределены.')
      continue
    }
    let method = e.allocation_method ?? batch.allocation_method
    let weights = base.map((b) => weightOf(method, b.it, b.goodsUzs, b.qtyBasis))
    if (!sum(weights).gt(0)) {
      const fallback = base.map((b) => b.goodsUzs)
      if (method !== 'value' && sum(fallback).gt(0)) {
        warnings.push(
          `Нет данных для распределения «${method === 'weight' ? 'по весу' : 'по объёму'}» — использована закупочная стоимость.`,
        )
        method = 'value'
        weights = fallback
      }
    }
    const shares = allocate(amount, weights)
    base.forEach((b, idx) => {
      allocatedByItem.set(b.it.id, allocatedByItem.get(b.it.id)!.plus(shares[idx]))
      allocations.push({ expense_id: e.id, batch_item_id: b.it.id, amount_uzs: shares[idx] })
    })
  }

  const itemCosts: ItemCost[] = base.map((b) => {
    const allocatedUzs = allocatedByItem.get(b.it.id) ?? new Decimal(0)
    const totalUzs = b.goodsUzs.plus(allocatedUzs)
    const plannedPrice = D(b.it.planned_sale_price_uzs)
    return {
      item_id: b.it.id,
      product_id: b.it.product_id,
      qtyOrdered: b.it.qty_ordered,
      qtyReceived: b.it.qty_received,
      qtyDefective: b.it.qty_defective,
      qtyBasis: b.qtyBasis,
      isReceived: b.it.qty_received > 0,
      goodsCny: b.goodsCny,
      goodsUzs: b.goodsUzs,
      allocatedUzs,
      totalUzs,
      unitCostUzs: b.qtyBasis > 0 ? roundCost(totalUzs.div(b.qtyBasis)) : null,
      plannedPrice,
      plannedRevenue: plannedPrice.mul(b.qtyBasis),
    }
  })

  const goodsCny = sum(itemCosts.map((i) => i.goodsCny))
  const goodsUzs = sum(itemCosts.map((i) => i.goodsUzs))
  const extrasUzs = logisticsUzs.plus(otherExtrasUzs)
  const totalCostUzs = goodsUzs.plus(extrasUzs)

  // Плановая экономика по позициям (комиссия/логистика Uzum — на единицу).
  let plannedRevenue = new Decimal(0)
  let plannedNet = new Decimal(0)
  let plannedSelling = new Decimal(0)
  let contributionTotal = new Decimal(0)
  let variableTotal = new Decimal(0)
  let monthlyUnits = new Decimal(0)
  let monthlyKnown = true
  for (const ic of itemCosts) {
    const it = items.find((x) => x.id === ic.item_id)!
    const sp = input.sellingParams?.(it) ?? ZERO_SELLING
    const ui: UnitInput = {
      price: ic.plannedPrice,
      commissionPct: sp.commissionPct,
      logistics: sp.logistics,
      otherPct: sp.otherPct,
      otherFixed: sp.otherFixed,
      packaging: sp.packaging,
      extra: sp.extra,
      ads: sp.ads,
      unitCost: 0,
    }
    const u = unitEconomics(ui)
    const qty = ic.qtyBasis
    plannedRevenue = plannedRevenue.plus(u.revenue.mul(qty))
    contributionTotal = contributionTotal.plus(u.contribution.mul(qty))
    variableTotal = variableTotal.plus(u.variableCosts.mul(qty))
    plannedSelling = plannedSelling.plus(u.revenue.minus(u.payout).plus(u.variableCosts).mul(qty))
    plannedNet = plannedNet.plus(u.contribution.mul(qty))
    const ms = input.monthlySales?.(it)
    if (ms === null || ms === undefined) monthlyKnown = false
    else monthlyUnits = monthlyUnits.plus(ms)
    if (ic.plannedPrice.isZero() && qty > 0) {
      if (!warnings.includes('Не у всех позиций указана плановая цена продажи.'))
        warnings.push('Не у всех позиций указана плановая цена продажи.')
    }
  }
  const plannedGross = plannedRevenue.minus(totalCostUzs)
  const plannedNetProfit = plannedNet.minus(totalCostUzs)
  const invested = totalCostUzs.plus(variableTotal)

  const qtyOrdered = items.reduce((s, i) => s + i.qty_ordered, 0)
  const qtyReceived = items.reduce((s, i) => s + i.qty_received, 0)
  const qtyDefective = items.reduce((s, i) => s + i.qty_defective, 0)
  const qtyAvailable = itemCosts.reduce((s, i) => s + i.qtyBasis, 0)

  const contributionPerUnit = qtyAvailable > 0 ? contributionTotal.div(qtyAvailable) : new Decimal(0)
  const bep = qtyAvailable > 0 ? breakEvenUnits(totalCostUzs, contributionPerUnit) : null
  if (qtyAvailable > 0 && bep === null) warnings.push('Партия убыточна при плановых ценах: вклад на единицу не положителен.')
  else if (bep !== null && bep > qtyAvailable)
    warnings.push('Точка безубыточности выше количества единиц в партии: партия не окупится при плановых ценах.')

  let paybackDays: number | null = null
  if (bep !== null && monthlyKnown && monthlyUnits.gt(0)) {
    paybackDays = Math.ceil((bep / monthlyUnits.toNumber()) * 30)
  }

  const prepay = D(batch.prepayment_cny)
  const paidExtra = payments
    .filter((p) => p.kind === 'supplier' && p.batch_id === batch.id && p.status === 'paid')
    .reduce((s, p) => s.plus(p.currency === 'CNY' ? D(p.amount) : D(p.amount_uzs).div(rate)), new Decimal(0))
  const paidCny = prepay.plus(paidExtra)
  const debtCny = Decimal.max(goodsCny.minus(paidCny), 0)
  if (paidCny.gt(goodsCny)) warnings.push('Оплачено поставщику больше стоимости товара.')

  return {
    batchId: batch.id,
    items: itemCosts,
    allocations,
    goodsCny,
    goodsUzs,
    logisticsUzs,
    otherExtrasUzs,
    extrasUzs,
    totalCostUzs,
    investedUzs: invested,
    qtyOrdered,
    qtyReceived,
    qtyDefective,
    qtyAvailable,
    unitCostAvgUzs: qtyAvailable > 0 ? roundCost(totalCostUzs.div(qtyAvailable)) : null,
    plannedRevenue,
    plannedGrossProfit: plannedGross,
    plannedNetProfit,
    plannedSellingCosts: plannedSelling,
    breakEvenUnits: bep,
    roiPct: pctOf(plannedNetProfit, invested),
    paybackDays,
    paidCny,
    debtCny,
    debtUzs: roundUzs(debtCny.mul(rate)),
    warnings,
  }
}

/** Оценка стоимости карго по тарифу: берётся большее из «по весу» и «по объёму». */
export function estimateCargo(
  b: Pick<PurchaseBatch, 'actual_weight_kg' | 'volume_m3' | 'cargo_tariff_kg' | 'cargo_tariff_m3' | 'cargo_currency'>,
): { amount: Decimal; basis: 'weight' | 'volume' | null } {
  const byWeight = D(b.actual_weight_kg).mul(D(b.cargo_tariff_kg))
  const byVolume = D(b.volume_m3).mul(D(b.cargo_tariff_m3))
  if (byWeight.isZero() && byVolume.isZero()) return { amount: new Decimal(0), basis: null }
  return byVolume.gt(byWeight)
    ? { amount: byVolume, basis: 'volume' }
    : { amount: byWeight, basis: 'weight' }
}

/** Стоимость товара и расход в UZS по правилам пересчёта (используется формами). */
export function expenseToUzs(amount: number, currency: 'UZS' | 'CNY' | 'USD', rate: number): Decimal {
  return toUzs(amount, currency, rate)
}

import { D, Decimal, pctOf, roundUzs, type Num } from '@/lib/money'
import { breakEvenUnits, priceForMargin, priceForProfit, unitEconomics } from '@/lib/calc/unit'

export interface CalculatorInput {
  purchasePriceCny: number
  qty: number
  cnyRate: number
  usdRate: number
  unitWeightKg: number
  cargoRate: number
  cargoCurrency: 'USD' | 'CNY' | 'UZS'
  /** Дополнительные расходы на всю партию, UZS (таможня, посредник и т. д.). */
  extraBatchCostsUzs: number
  plannedPrice: number
  sellerDiscount: number
  commissionPct: number
  /** Логистика и обработка заказа Uzum, UZS на единицу. */
  logisticsPerUnit: number
  packagingPerUnit: number
  adsMode: 'per_sale' | 'per_batch'
  adsAmount: number
  otherPerUnit: number
}

export const DEFAULT_CALCULATOR: CalculatorInput = {
  purchasePriceCny: 0,
  qty: 100,
  cnyRate: 0,
  usdRate: 0,
  unitWeightKg: 0,
  cargoRate: 0,
  cargoCurrency: 'USD',
  extraBatchCostsUzs: 0,
  plannedPrice: 0,
  sellerDiscount: 0,
  commissionPct: 0,
  logisticsPerUnit: 0,
  packagingPerUnit: 0,
  adsMode: 'per_sale',
  adsAmount: 0,
  otherPerUnit: 0,
}

export interface CalculatorResult {
  purchasePerUnit: Decimal
  cargoPerUnit: Decimal
  extraPerUnit: Decimal
  batchAdsPerUnit: Decimal
  unitCost: Decimal
  goodsTotal: Decimal
  cargoTotal: Decimal
  extraTotal: Decimal
  totalCost: Decimal
  batchAds: Decimal
  revenuePerUnit: Decimal
  commissionPerUnit: Decimal
  payoutPerUnit: Decimal
  profitPerUnit: Decimal
  marginPct: Decimal | null
  markupPct: Decimal | null
  roiPct: Decimal | null
  contributionPerUnit: Decimal
  breakEvenUnits: number | null
  breakEvenPct: Decimal | null
  scenarios: { pct: number; unitsSold: number; revenue: Decimal; profit: Decimal }[]
  valid: boolean
}

const cargoPerKgUzs = (i: CalculatorInput): Decimal => {
  switch (i.cargoCurrency) {
    case 'USD':
      return D(i.cargoRate).mul(D(i.usdRate))
    case 'CNY':
      return D(i.cargoRate).mul(D(i.cnyRate))
    default:
      return D(i.cargoRate)
  }
}

export function calculate(i: CalculatorInput): CalculatorResult {
  const qty = Math.max(0, Math.floor(i.qty))
  const q = D(qty)
  const purchasePerUnit = roundUzs(D(i.purchasePriceCny).mul(D(i.cnyRate)))
  const cargoPerUnit = D(i.unitWeightKg).mul(cargoPerKgUzs(i))
  const goodsTotal = purchasePerUnit.mul(q)
  const cargoTotal = cargoPerUnit.mul(q)
  const extraTotal = D(i.extraBatchCostsUzs)
  const totalCost = goodsTotal.plus(cargoTotal).plus(extraTotal)
  const batchAds = i.adsMode === 'per_batch' ? D(i.adsAmount) : new Decimal(0)
  const adsPerSale = i.adsMode === 'per_sale' ? D(i.adsAmount) : new Decimal(0)
  const unitCost = qty > 0 ? totalCost.div(q) : new Decimal(0)
  const extraPerUnit = qty > 0 ? extraTotal.div(q) : new Decimal(0)
  const batchAdsPerUnit = qty > 0 ? batchAds.div(q) : new Decimal(0)

  const u = unitEconomics({
    price: i.plannedPrice,
    discount: i.sellerDiscount,
    commissionPct: i.commissionPct,
    logistics: i.logisticsPerUnit,
    packaging: i.packagingPerUnit,
    extra: i.otherPerUnit,
    ads: adsPerSale,
    unitCost,
  })

  // Прибыль на единицу при 100% реализации: рекламные расходы партии распределяются на все единицы.
  const profitPerUnit = u.profit.minus(batchAdsPerUnit)
  const revenue = u.revenue
  const bep = qty > 0 ? breakEvenUnits(totalCost.plus(batchAds), u.contribution) : null

  const scenarios = [25, 50, 75, 100].map((pct) => {
    const unitsSold = Math.round((qty * pct) / 100)
    const rev = revenue.mul(unitsSold)
    return {
      pct,
      unitsSold,
      revenue: rev,
      profit: u.contribution.mul(unitsSold).minus(totalCost).minus(batchAds),
    }
  })

  return {
    purchasePerUnit,
    cargoPerUnit,
    extraPerUnit,
    batchAdsPerUnit,
    unitCost,
    goodsTotal,
    cargoTotal,
    extraTotal,
    totalCost,
    batchAds,
    revenuePerUnit: revenue,
    commissionPerUnit: u.commission,
    payoutPerUnit: u.payout,
    profitPerUnit,
    marginPct: pctOf(profitPerUnit, revenue),
    markupPct: pctOf(profitPerUnit, unitCost),
    roiPct: pctOf(profitPerUnit, unitCost.plus(u.variableCosts).plus(batchAdsPerUnit)),
    contributionPerUnit: u.contribution,
    breakEvenUnits: bep,
    breakEvenPct: bep !== null && qty > 0 ? D(bep).div(qty).mul(100) : null,
    scenarios,
    valid: qty > 0 && D(i.purchasePriceCny).gt(0) && D(i.cnyRate).gt(0),
  }
}

export type ReverseMode = 'profit' | 'margin'

/** Обратный расчёт: цена продажи для желаемой прибыли на единицу (UZS) или маржинальности (%). */
export function reversePrice(i: CalculatorInput, mode: ReverseMode, target: Num): Decimal | null {
  const r = calculate(i)
  const base = {
    discount: i.sellerDiscount,
    commissionPct: i.commissionPct,
    logistics: i.logisticsPerUnit,
    packaging: i.packagingPerUnit,
    extra: i.otherPerUnit,
    ads: i.adsMode === 'per_sale' ? i.adsAmount : 0,
    // рекламу партии включаем в себестоимость единицы — цель достигается при полной реализации
    unitCost: r.unitCost.plus(r.batchAdsPerUnit),
  }
  return mode === 'profit' ? priceForProfit(target, base) : priceForMargin(target, base)
}

export interface ScenarioDeltas {
  rate: number
  cargo: number
  price: number
}

export function withDeltas(i: CalculatorInput, d: ScenarioDeltas): CalculatorInput {
  const f = (pct: number) => 1 + pct / 100
  return {
    ...i,
    cnyRate: D(i.cnyRate).mul(f(d.rate)).toNumber(),
    usdRate: D(i.usdRate).mul(f(d.rate)).toNumber(),
    cargoRate: D(i.cargoRate).mul(f(d.cargo)).toNumber(),
    plannedPrice: D(i.plannedPrice).mul(f(d.price)).toNumber(),
  }
}

export interface ScenarioRow {
  deltaPct: number
  profitPerUnit: Decimal
  marginPct: Decimal | null
  batchProfit: Decimal
}

/**
 * Чувствительность прибыли к одному параметру.
 * Изменение курса применяется и к CNY/UZS, и к USD/UZS (оба зависят от ситуации на валютном рынке).
 */
export function sensitivity(
  i: CalculatorInput,
  param: keyof ScenarioDeltas,
  deltas: number[],
): ScenarioRow[] {
  return deltas.map((delta) => {
    const r = calculate(withDeltas(i, { rate: 0, cargo: 0, price: 0, [param]: delta }))
    return {
      deltaPct: delta,
      profitPerUnit: r.profitPerUnit,
      marginPct: r.marginPct,
      batchProfit: r.profitPerUnit.mul(Math.max(0, Math.floor(i.qty))),
    }
  })
}

/** Таблица «курс × цена продажи» → прибыль всей партии. */
export function rateVsPriceGrid(
  i: CalculatorInput,
  rateDeltas: number[],
  priceDeltas: number[],
): Decimal[][] {
  return rateDeltas.map((rd) =>
    priceDeltas.map((pd) => {
      const r = calculate(withDeltas(i, { rate: rd, cargo: 0, price: pd }))
      return r.profitPerUnit.mul(Math.max(0, Math.floor(i.qty)))
    }),
  )
}

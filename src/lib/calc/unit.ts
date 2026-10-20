import { D, Decimal, pctOf, roundUzs, sum, type Num } from '@/lib/money'

/**
 * Экономика одной единицы товара (общая для калькулятора, плана партии и оценки закупки).
 *
 * Формулы (см. раздел 17 ТЗ):
 *   выручка            = цена − скидка продавца
 *   комиссия           = выручка × комиссия%
 *   прочие удержания   = выручка × прочие% + фиксированные удержания
 *   чистая выплата     = выручка − комиссия − логистика Uzum − прочие удержания
 *   переменные расходы = упаковка + прочие на единицу + реклама на единицу
 *   вклад (contribution) = чистая выплата − переменные расходы
 *   прибыль            = вклад − себестоимость единицы
 *   маржинальность     = прибыль / выручка × 100%
 *   наценка            = прибыль / себестоимость × 100%
 *   ROI                = прибыль / вложенный капитал на единицу × 100%,
 *                        где капитал = себестоимость + переменные расходы
 *                        (комиссия и логистика Uzum удерживаются из выплаты и не вкладываются заранее)
 */
export interface UnitInput {
  price: Num
  discount?: Num
  commissionPct?: Num
  logistics?: Num
  otherPct?: Num
  otherFixed?: Num
  packaging?: Num
  extra?: Num
  ads?: Num
  unitCost: Num
}

export interface UnitResult {
  price: Decimal
  discount: Decimal
  revenue: Decimal
  commission: Decimal
  logistics: Decimal
  otherDeductions: Decimal
  payout: Decimal
  variableCosts: Decimal
  contribution: Decimal
  unitCost: Decimal
  profit: Decimal
  marginPct: Decimal | null
  markupPct: Decimal | null
  roiPct: Decimal | null
}

export function unitEconomics(i: UnitInput): UnitResult {
  const price = D(i.price)
  const discount = D(i.discount)
  const revenue = Decimal.max(price.minus(discount), 0)
  const commission = revenue.mul(D(i.commissionPct)).div(100)
  const logistics = D(i.logistics)
  const otherDeductions = revenue.mul(D(i.otherPct)).div(100).plus(D(i.otherFixed))
  const payout = revenue.minus(commission).minus(logistics).minus(otherDeductions)
  const variableCosts = sum([i.packaging, i.extra, i.ads])
  const contribution = payout.minus(variableCosts)
  const unitCost = D(i.unitCost)
  const profit = contribution.minus(unitCost)
  const capital = unitCost.plus(variableCosts)
  return {
    price,
    discount,
    revenue,
    commission,
    logistics,
    otherDeductions,
    payout,
    variableCosts,
    contribution,
    unitCost,
    profit,
    marginPct: pctOf(profit, revenue),
    markupPct: pctOf(profit, unitCost),
    roiPct: pctOf(profit, capital),
  }
}

/**
 * Точка безубыточности по партии: минимальное число проданных единиц, при котором
 * суммарный вклад покрывает вложения в партию (постоянные для партии расходы).
 * Возвращает null, если вклад на единицу ≤ 0 (окупить партию невозможно).
 */
export function breakEvenUnits(fixedCosts: Num, contributionPerUnit: Num): number | null {
  const c = D(contributionPerUnit)
  if (!c.gt(0)) return null
  const f = D(fixedCosts)
  if (f.lte(0)) return 0
  return f.div(c).ceil().toNumber()
}

/** Обратный расчёт: цена продажи для желаемой прибыли на единицу. */
export function priceForProfit(
  desiredProfit: Num,
  i: Omit<UnitInput, 'price'>,
): Decimal | null {
  const rate = D(1).minus(D(i.commissionPct).div(100)).minus(D(i.otherPct).div(100))
  if (!rate.gt(0)) return null
  const fixed = sum([i.logistics, i.otherFixed, i.packaging, i.extra, i.ads, i.unitCost])
  const revenue = D(desiredProfit).plus(fixed).div(rate)
  return roundUzs(revenue.plus(D(i.discount)))
}

/** Обратный расчёт: цена продажи для желаемой маржинальности (прибыль / выручка). */
export function priceForMargin(
  desiredMarginPct: Num,
  i: Omit<UnitInput, 'price'>,
): Decimal | null {
  const denom = D(1)
    .minus(D(i.commissionPct).div(100))
    .minus(D(i.otherPct).div(100))
    .minus(D(desiredMarginPct).div(100))
  if (!denom.gt(0)) return null
  const fixed = sum([i.logistics, i.otherFixed, i.packaging, i.extra, i.ads, i.unitCost])
  const revenue = fixed.div(denom)
  return roundUzs(revenue.plus(D(i.discount)))
}

import { D, Decimal, pctOf, roundUzs } from '@/lib/money'
import { breakEvenUnits } from '@/lib/calc/unit'
import type { ProductEvaluation } from '@/types/db'

export interface EvaluationResult {
  qty: number
  sellableQty: number
  unitCost: Decimal
  capital: Decimal
  goodsCost: Decimal
  deliveryCost: Decimal
  revenue: Decimal
  sellingCosts: Decimal
  netProfit: Decimal
  marginPct: Decimal | null
  roiPct: Decimal | null
  breakEvenUnits: number | null
  /** Месяцев на реализацию всей годной партии (null — нет прогноза продаж). */
  monthsToSell: Decimal | null
  /** Месяцев до возврата вложений (по точке безубыточности). */
  paybackMonths: Decimal | null
  warnings: string[]
  /** Достаточно ли данных для надёжного прогноза. */
  reliable: boolean
}

/**
 * Оценка закупки при заказе минимальной партии (MOQ).
 *  - из-за брака/возвратов продаваемое количество = MOQ × (1 − риск%);
 *    стоимость всей партии при этом сохраняется;
 *  - комиссия считается от цены продажи, прочие расходы реализации — на проданную единицу;
 *  - ROI = чистая прибыль / (стоимость партии + расходы реализации).
 */
export function evaluate(e: ProductEvaluation): EvaluationResult {
  const warnings: string[] = []
  const qty = e.moq
  const goodsCost = roundUzs(D(e.supplier_price_cny).mul(D(e.cny_rate)).mul(qty))
  const deliveryCost = roundUzs(D(e.delivery_per_unit_uzs).mul(qty))
  const capital = goodsCost.plus(deliveryCost)
  const sellable = Math.max(0, Math.floor(qty * (1 - D(e.defect_return_pct).div(100).toNumber())))
  const price = D(e.sale_price_uzs)
  const commission = price.mul(D(e.commission_pct)).div(100)
  const perUnitSelling = commission.plus(D(e.selling_costs_per_unit_uzs))
  const contribution = price.minus(perUnitSelling)
  const revenue = price.mul(sellable)
  const sellingCosts = perUnitSelling.mul(sellable)
  const netProfit = contribution.mul(sellable).minus(capital)
  const bep = sellable > 0 ? breakEvenUnits(capital, contribution) : null

  const monthly = e.monthly_sales
  const monthsToSell = monthly && monthly > 0 ? D(sellable).div(monthly) : null
  const paybackMonths = monthly && monthly > 0 && bep !== null ? D(bep).div(monthly) : null

  if (netProfit.lt(0)) warnings.push('Товар убыточен при заданных параметрах.')
  if (bep === null && sellable > 0) warnings.push('Вклад на единицу не положителен — партия не окупится.')
  else if (bep !== null && bep > sellable) warnings.push('Точка безубыточности выше годного количества — вложения не вернутся.')
  if (e.budget_uzs !== null && capital.gt(D(e.budget_uzs))) warnings.push('Необходимый капитал превышает бюджет на закупку.')
  const margin = pctOf(netProfit, revenue)
  if (margin !== null && margin.gt(0) && margin.lt(10)) warnings.push('Низкая маржинальность (< 10%): малый запас прочности.')
  if (monthsToSell !== null && monthsToSell.gt(6)) warnings.push('Долгая реализация: партия продаётся дольше 6 месяцев.')
  const reliable = monthly !== null && monthly > 0 && D(e.sale_price_uzs).gt(0) && D(e.supplier_price_cny).gt(0)
  if (!reliable) warnings.push('Недостаточно данных для надёжного прогноза (укажите цену, закупку и объём продаж в месяц).')

  return {
    qty,
    sellableQty: sellable,
    unitCost: sellable > 0 ? capital.div(sellable) : new Decimal(0),
    capital,
    goodsCost,
    deliveryCost,
    revenue,
    sellingCosts,
    netProfit,
    marginPct: margin,
    roiPct: pctOf(netProfit, capital.plus(sellingCosts)),
    breakEvenUnits: bep,
    monthsToSell,
    paybackMonths,
    warnings,
    reliable,
  }
}

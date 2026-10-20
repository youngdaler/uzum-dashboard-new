import Decimal from 'decimal.js'
import type { Currency } from '@/types/db'

/**
 * Единые правила денежной арифметики:
 *  - все вычисления — Decimal (никакого float);
 *  - режим округления — ROUND_HALF_UP;
 *  - суммы UZS округляются до 2 знаков (хранятся numeric(20,2)), отображаются целыми;
 *  - себестоимость единицы — 4 знака (numeric(20,4));
 *  - курсы — 6 знаков;
 *  - пересчёт валюты: amount_uzs = round2(amount × rate), курс фиксируется на дату операции;
 *  - распределение сумм по позициям — методом наибольшего остатка: сумма долей
 *    всегда в точности равна распределяемой сумме (ничего не теряется и не дублируется).
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export type Num = Decimal.Value | null | undefined
export { Decimal }

export const ZERO = new Decimal(0)

/** Безопасное создание Decimal: null/undefined/NaN/'' → 0. */
export function D(v: Num): Decimal {
  if (v === null || v === undefined || v === '') return new Decimal(0)
  try {
    const d = new Decimal(v)
    return d.isFinite() ? d : new Decimal(0)
  } catch {
    return new Decimal(0)
  }
}

export const roundUzs = (v: Num): Decimal => D(v).toDecimalPlaces(2)
export const roundCost = (v: Num): Decimal => D(v).toDecimalPlaces(4)
export const roundRate = (v: Num): Decimal => D(v).toDecimalPlaces(6)
export const roundPct = (v: Num): Decimal => D(v).toDecimalPlaces(2)

/** Пересчёт суммы в UZS по курсу на дату операции. */
export function toUzs(amount: Num, currency: Currency, rate: Num): Decimal {
  if (currency === 'UZS') return roundUzs(amount)
  return roundUzs(D(amount).mul(D(rate)))
}

export function sum(values: Num[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Decimal(0))
}

/** a / b, либо null если b = 0 (чтобы не показывать Infinity/NaN). */
export function div(a: Num, b: Num): Decimal | null {
  const bb = D(b)
  if (bb.isZero()) return null
  return D(a).div(bb)
}

/** Процент: part / whole × 100, null если whole = 0. */
export function pctOf(part: Num, whole: Num): Decimal | null {
  const r = div(part, whole)
  return r === null ? null : r.mul(100)
}

export const toNum = (v: Num): number => D(v).toNumber()

/**
 * Распределение суммы total по весам методом наибольшего остатка (точность 0.01).
 * Если все веса равны нулю — распределяет поровну.
 * Гарантия: sum(result) === roundUzs(total).
 */
export function allocate(total: Num, weights: Num[]): Decimal[] {
  const n = weights.length
  if (n === 0) return []
  const totalCents = D(total).mul(100).toDecimalPlaces(0)
  const w = weights.map((x) => {
    const d = D(x)
    return d.isNegative() ? new Decimal(0) : d
  })
  let wSum = sum(w)
  const useWeights = wSum.gt(0) ? w : w.map(() => new Decimal(1))
  if (!wSum.gt(0)) wSum = new Decimal(n)

  const raw = useWeights.map((x) => totalCents.mul(x).div(wSum))
  const floors = raw.map((r) => r.floor())
  let remainder = totalCents.minus(sum(floors)).toNumber()
  const order = raw
    .map((r, i) => ({ i, frac: r.minus(floors[i]) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i)
  const cents = floors.map((f) => f)
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) {
    cents[order[k].i] = cents[order[k].i].plus(1)
  }
  return cents.map((c) => c.div(100))
}

import { format as fmt, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { D, type Num } from '@/lib/money'

const intFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const dec2Fmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 1 234 567 сўм — суммы в UZS с разделителями тысяч, без копеек. */
export function formatUzs(v: Num, withUnit = true): string {
  const n = D(v).toDecimalPlaces(0).toNumber()
  const s = intFmt.format(Object.is(n, -0) ? 0 : n)
  return withUnit ? `${s} сум` : s
}

export function formatNumber(v: Num, digits = 0): string {
  const d = D(v)
  if (digits === 0) return intFmt.format(d.toDecimalPlaces(0).toNumber())
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(d.toNumber())
}

export function formatMoney(v: Num, currency: 'UZS' | 'CNY' | 'USD'): string {
  if (currency === 'UZS') return formatUzs(v)
  const sym = currency === 'CNY' ? '¥' : '$'
  return `${sym}${dec2Fmt.format(D(v).toNumber())}`
}

/** Процент с одним знаком; null → «—». */
export function formatPct(v: Num | null, digits = 1): string {
  if (v === null || v === undefined) return '—'
  return `${formatNumber(v, digits)}%`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return fmt(parseISO(iso), 'dd.MM.yyyy', { locale: ru })
  } catch {
    return iso
  }
}

/** Сокращение больших сумм для осей графиков: 1,2 млн / 350 тыс. */
export function compactUzs(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1).replace('.', ',')} млрд`
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.', ',')} млн`
  if (abs >= 1_000) return `${Math.round(v / 1_000)} тыс`
  return String(Math.round(v))
}

export const todayIso = (): string => fmt(new Date(), 'yyyy-MM-dd')

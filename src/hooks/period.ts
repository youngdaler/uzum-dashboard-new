import { endOfMonth, format, startOfMonth, startOfYear, subDays, subMonths } from 'date-fns'
import { useSyncExternalStore } from 'react'
import type { DateRange } from '@/lib/calc/finance'
import type { Db } from '@/types/db'

export type PresetKey = '7d' | '30d' | '90d' | 'month' | 'prev_month' | 'year' | 'all' | 'custom'

export const PRESET_LABEL: Record<PresetKey, string> = {
  '7d': '7 дней',
  '30d': '30 дней',
  '90d': '90 дней',
  month: 'Этот месяц',
  prev_month: 'Прошлый месяц',
  year: 'С начала года',
  all: 'Всё время',
  custom: 'Свой период',
}

interface PeriodState {
  preset: PresetKey
  from: string
  to: string
}

const KEY = 'uzum-period'
const iso = (d: Date) => format(d, 'yyyy-MM-dd')

function load(): PeriodState {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as PeriodState
      if (s.preset in PRESET_LABEL) return s
    }
  } catch {
    /* sessionStorage недоступен — используем значение по умолчанию */
  }
  return { preset: '30d', from: '', to: '' }
}

let state = load()
const listeners = new Set<() => void>()

export function setPeriod(patch: Partial<PeriodState>): void {
  state = { ...state, ...patch }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* не критично */
  }
  listeners.forEach((l) => l())
}

export function usePeriodState(): PeriodState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** Первая дата в данных (для «Всё время»). */
export function firstDataDate(db: Db): string {
  const dates = [
    ...db.sales.map((s) => s.sale_date),
    ...db.expenses.map((e) => e.expense_date),
    ...db.purchase_batches.map((b) => b.order_date),
    ...db.inventory_movements.map((m) => m.movement_date),
  ]
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : iso(subDays(new Date(), 30))
}

export function resolveRange(s: PeriodState, db: Db, now = new Date()): DateRange {
  const today = iso(now)
  switch (s.preset) {
    case '7d':
      return { from: iso(subDays(now, 6)), to: today }
    case '30d':
      return { from: iso(subDays(now, 29)), to: today }
    case '90d':
      return { from: iso(subDays(now, 89)), to: today }
    case 'month':
      return { from: iso(startOfMonth(now)), to: today }
    case 'prev_month': {
      const p = subMonths(now, 1)
      return { from: iso(startOfMonth(p)), to: iso(endOfMonth(p)) }
    }
    case 'year':
      return { from: iso(startOfYear(now)), to: today }
    case 'all':
      return { from: firstDataDate(db), to: today }
    case 'custom': {
      const from = s.from || iso(subDays(now, 29))
      const to = s.to || today
      return from <= to ? { from, to } : { from: to, to: from }
    }
  }
}

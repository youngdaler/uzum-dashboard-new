import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, toneText } from '@/components/ui/card'
import { D, type Num } from '@/lib/money'
import { formatUzs } from '@/lib/format'
import { cn } from '@/lib/utils'

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'primary'

export function StatCard({
  label,
  value,
  sub,
  tone = 'neutral',
  icon: Icon,
  delta,
  hint,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
  icon?: LucideIcon
  /** Изменение к предыдущему периоду в процентах (null — нет базы для сравнения). */
  delta?: number | null
  hint?: string
}) {
  return (
    <Card className="px-3.5 py-3" title={hint}>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      </div>
      <div className={cn('num mt-1 text-lg font-semibold leading-tight', toneText[tone])}>{value}</div>
      <div className="mt-0.5 flex min-h-4 items-center gap-2 text-xs text-muted-foreground">
        {delta !== undefined && delta !== null && (
          <span className={cn('inline-flex items-center gap-0.5 font-medium', delta >= 0 ? 'text-success' : 'text-danger')}>
            {delta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {Math.abs(delta).toFixed(0)}%
          </span>
        )}
        {sub ? <span className="truncate">{sub}</span> : null}
      </div>
    </Card>
  )
}

export function EmptyState({ icon: Icon, title, description, action }: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      {Icon ? (
        <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
      ) : null}
      <p className="font-medium">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

/** Сумма в UZS с цветом по знаку (для прибыли/убытка). */
export function Money({ value, signed = false, className }: { value: Num; signed?: boolean; className?: string }) {
  const d = D(value)
  const color = signed ? (d.isZero() ? '' : d.isNegative() ? 'text-danger' : 'text-success') : ''
  return <span className={cn('num', color, className)}>{formatUzs(d)}</span>
}

export function Pct({ value, signed = true, digits = 1 }: { value: Num | null; signed?: boolean; digits?: number }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>
  const d = D(value)
  const color = signed ? (d.isZero() ? '' : d.isNegative() ? 'text-danger' : 'text-success') : ''
  return <span className={cn('num', color)}>{d.toDecimalPlaces(digits).toString().replace('.', ',')}%</span>
}

export function Notice({ tone = 'warning', children, className }: { tone?: 'warning' | 'danger' | 'primary' | 'success'; children: ReactNode; className?: string }) {
  const map = {
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    primary: 'bg-primary-soft text-primary',
    success: 'bg-success-soft text-success',
  }
  return <div className={cn('rounded-lg px-3 py-2 text-sm', map[tone], className)}>{children}</div>
}

export function Loading({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-60 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-input border-t-primary" />
      {label}
    </div>
  )
}

export function KeyValue({ rows, className }: { rows: { label: ReactNode; value: ReactNode; strong?: boolean; indent?: boolean; border?: boolean }[]; className?: string }) {
  return (
    <dl className={cn('text-sm', className)}>
      {rows.map((r, i) => (
        <div
          key={i}
          className={cn('flex items-baseline justify-between gap-4 py-1.5', r.border && 'border-t', r.strong && 'font-semibold', r.indent && 'pl-4 text-muted-foreground')}
        >
          <dt>{r.label}</dt>
          <dd className="num text-right">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Фильтр по диапазону дат (пустые значения — без ограничения). */
export function DateRangeFilter({ from, to, onChange }: { from: string; to: string; onChange: (r: { from: string; to: string }) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        aria-label="С даты"
        value={from}
        max={to || undefined}
        onChange={(e) => onChange({ from: e.target.value, to })}
        className="h-9 rounded-lg border border-input bg-card px-2 text-sm"
      />
      <span className="text-muted-foreground">—</span>
      <input
        type="date"
        aria-label="По дату"
        value={to}
        min={from || undefined}
        onChange={(e) => onChange({ from, to: e.target.value })}
        className="h-9 rounded-lg border border-input bg-card px-2 text-sm"
      />
      {(from || to) && (
        <button type="button" className="px-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange({ from: '', to: '' })}>
          сбросить
        </button>
      )}
    </div>
  )
}

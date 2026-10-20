import type { ReactNode } from 'react'
import { ResponsiveContainer } from 'recharts'
import { compactUzs, formatNumber, formatUzs } from '@/lib/format'

export const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
]

interface TipProps {
  active?: boolean
  payload?: { name?: string | number; value?: number | string; color?: string; dataKey?: string | number }[]
  label?: string | number
  /** Форматирование значений: по умолчанию суммы в UZS. */
  format?: (v: number, name: string) => string
}

export function ChartTooltip({ active, payload, label, format }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-lg">
      {label !== undefined && label !== '' && <div className="mb-1 font-medium">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="num font-medium">
            {format ? format(Number(p.value), String(p.name)) : formatUzs(Number(p.value))}
          </span>
        </div>
      ))}
    </div>
  )
}

export const axisUzs = (v: number) => compactUzs(v)
export const axisNum = (v: number) => formatNumber(v)

export function Chart({ height = 260, children }: { height?: number; children: ReactNode }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children as never}
      </ResponsiveContainer>
    </div>
  )
}

export function NoData({ height = 260, text = 'Нет данных за выбранный период' }: { height?: number; text?: string }) {
  return (
    <div style={{ height }} className="flex items-center justify-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}

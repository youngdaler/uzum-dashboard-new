import { useMemo } from 'react'
import { Input, Select } from '@/components/ui/form'
import { PRESET_LABEL, resolveRange, setPeriod, usePeriodState, type PresetKey } from '@/hooks/period'
import { useDb } from '@/data/store'
import type { DateRange } from '@/lib/calc/finance'

/** Выбор периода, общий для дашборда, финансов и аналитики. */
export function usePeriod(): DateRange {
  const s = usePeriodState()
  const db = useDb()
  return useMemo(() => resolveRange(s, db), [s, db])
}

export function PeriodPicker() {
  const s = usePeriodState()
  const range = usePeriod()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Период"
        value={s.preset}
        onChange={(e) => {
          const preset = e.target.value as PresetKey
          setPeriod(preset === 'custom' ? { preset, from: range.from, to: range.to } : { preset })
        }}
        className="w-44"
      >
        {(Object.keys(PRESET_LABEL) as PresetKey[]).map((k) => (
          <option key={k} value={k}>
            {PRESET_LABEL[k]}
          </option>
        ))}
      </Select>
      {s.preset === 'custom' && (
        <>
          <Input type="date" aria-label="С даты" value={s.from} max={s.to || undefined} onChange={(e) => setPeriod({ from: e.target.value })} className="w-36" />
          <span className="text-muted-foreground">—</span>
          <Input type="date" aria-label="По дату" value={s.to} min={s.from || undefined} onChange={(e) => setPeriod({ to: e.target.value })} className="w-36" />
        </>
      )}
    </div>
  )
}

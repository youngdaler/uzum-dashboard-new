import { useCallback, useState } from 'react'
import { toast } from 'sonner'

/** Выполняет действие с показом ошибки тостом. Возвращает true при успехе. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (fn: () => Promise<unknown>, success?: string): Promise<boolean> => {
    setBusy(true)
    try {
      await fn()
      if (success) toast.success(success)
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Операция не выполнена.')
      return false
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, run }
}

/** Преобразует пустую строку/NaN числового поля в null. */
export const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { rateFor, savePayment } from '@/data/actions'
import { useAppState } from '@/data/store'
import { useAction } from '@/hooks/use-action'
import { formatUzs, todayIso } from '@/lib/format'
import { toUzs } from '@/lib/money'
import type { Payment, PaymentKind } from '@/types/db'

export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  supplier: 'Оплата поставщику',
  owner_in: 'Вложение владельца',
  owner_out: 'Вывод владельцем',
}

const schema = z.object({
  kind: z.enum(['supplier', 'owner_in', 'owner_out']),
  payment_date: z.string().min(1, 'Укажите дату'),
  status: z.enum(['paid', 'scheduled']),
  due_date: z.string(),
  batch_id: z.string(),
  amount: z.number({ error: 'Введите сумму' }).positive('Сумма должна быть больше нуля'),
  currency: z.enum(['UZS', 'CNY', 'USD']),
  rate_to_uzs: z.number({ error: 'Введите курс' }).min(0),
  note: z.string(),
})
type Values = z.infer<typeof schema>

export function PaymentForm({ payment, presetBatchId, onClose }: { payment: Payment | null; presetBatchId?: string; onClose: () => void }) {
  const { db } = useAppState()
  const { busy, run } = useAction()
  const first = useRef(true)
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: payment
      ? {
          kind: payment.kind,
          payment_date: payment.payment_date,
          status: payment.status,
          due_date: payment.due_date ?? '',
          batch_id: payment.batch_id ?? '',
          amount: payment.amount,
          currency: payment.currency,
          rate_to_uzs: payment.rate_to_uzs,
          note: payment.note ?? '',
        }
      : {
          kind: presetBatchId ? 'supplier' : 'owner_in',
          payment_date: todayIso(),
          status: 'paid',
          due_date: '',
          batch_id: presetBatchId ?? '',
          amount: undefined as unknown as number,
          currency: presetBatchId ? 'CNY' : 'UZS',
          rate_to_uzs: 1,
          note: '',
        },
  })
  const w = useWatch({ control })

  useEffect(() => {
    if (first.current) {
      first.current = false
      if (payment) return
    }
    if (w.currency === 'UZS') setValue('rate_to_uzs', 1)
    else {
      const r = rateFor(w.currency ?? 'UZS', w.payment_date ?? todayIso())
      if (r) setValue('rate_to_uzs', r)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.currency, w.payment_date])

  const uzs = w.amount && w.rate_to_uzs ? toUzs(w.amount, w.currency ?? 'UZS', w.rate_to_uzs) : null

  const submit = handleSubmit((v) =>
    run(async () => {
      await savePayment(payment?.id ?? null, {
        kind: v.kind,
        payment_date: v.payment_date,
        due_date: v.status === 'scheduled' ? v.due_date || null : null,
        status: v.status,
        batch_id: v.kind === 'supplier' ? v.batch_id || null : null,
        amount: v.amount,
        currency: v.currency,
        rate_to_uzs: v.currency === 'UZS' ? 1 : v.rate_to_uzs,
        note: v.note.trim() || null,
      })
      onClose()
    }, payment ? 'Платёж обновлён' : 'Платёж добавлен'),
  )

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Тип платежа">
          <Select {...register('kind')}>
            {Object.entries(PAYMENT_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </Field>
        <Field label="Статус">
          <Select {...register('status')}>
            <option value="paid">Проведён</option>
            <option value="scheduled">Запланирован</option>
          </Select>
        </Field>
        <Field label={w.status === 'scheduled' ? 'Дата создания' : 'Дата платежа *'} error={errors.payment_date?.message}>
          <Input type="date" {...register('payment_date')} />
        </Field>
        {w.status === 'scheduled' && (
          <Field label="Срок платежа">
            <Input type="date" {...register('due_date')} />
          </Field>
        )}
        {w.kind === 'supplier' && (
          <Field label="Партия *" className="sm:col-span-2">
            <Select {...register('batch_id')} disabled={!!presetBatchId && !payment}>
              <option value="">— выберите партию —</option>
              {db.purchase_batches.map((b) => (
                <option key={b.id} value={b.id}>{b.batch_no}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Сумма *" error={errors.amount?.message}>
          <Input type="number" step="0.01" {...register('amount', { valueAsNumber: true })} aria-invalid={!!errors.amount} />
        </Field>
        <div className="grid grid-cols-[96px_1fr] gap-2">
          <Field label="Валюта">
            <Select {...register('currency')}>
              <option value="UZS">UZS</option>
              <option value="CNY">CNY</option>
              <option value="USD">USD</option>
            </Select>
          </Field>
          <Field label="Курс к UZS" error={errors.rate_to_uzs?.message}>
            <Input type="number" step="0.0001" disabled={w.currency === 'UZS'} {...register('rate_to_uzs', { valueAsNumber: true })} />
          </Field>
        </div>
        {uzs && w.currency !== 'UZS' && (
          <p className="text-sm text-muted-foreground sm:col-span-2">
            Итого в UZS: <b className="num text-foreground">{formatUzs(uzs)}</b>
          </p>
        )}
        <Field label="Комментарий" className="sm:col-span-2">
          <Textarea rows={2} {...register('note')} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Отмена</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
      </DialogFooter>
    </form>
  )
}

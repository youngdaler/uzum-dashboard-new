import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { rateFor, saveExpense } from '@/data/actions'
import { useAppState, useDerived } from '@/data/store'
import { useAction } from '@/hooks/use-action'
import { ALLOCATION_LABEL, PAYMENT_METHOD_LABEL } from '@/lib/constants'
import { formatUzs, todayIso } from '@/lib/format'
import { toUzs } from '@/lib/money'
import type { Expense } from '@/types/db'

const schema = z.object({
  expense_date: z.string().min(1, 'Укажите дату'),
  category_id: z.string().min(1, 'Выберите категорию'),
  amount: z.number({ error: 'Введите сумму' }).positive('Сумма должна быть больше нуля'),
  currency: z.enum(['UZS', 'CNY', 'USD']),
  rate_to_uzs: z.number({ error: 'Введите курс' }).min(0),
  batch_id: z.string(),
  batch_item_id: z.string(),
  allocation_method: z.string(),
  payment_method: z.enum(['cash', 'card', 'transfer', 'other']),
  payment_status: z.enum(['paid', 'pending']),
  due_date: z.string(),
  comment: z.string(),
})
type Values = z.infer<typeof schema>

export function ExpenseForm({ expense, presetBatchId, onClose }: { expense: Expense | null; presetBatchId?: string; onClose: () => void }) {
  const { db } = useAppState()
  const derived = useDerived()
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
    defaultValues: expense
      ? {
          expense_date: expense.expense_date,
          category_id: expense.category_id,
          amount: expense.amount,
          currency: expense.currency,
          rate_to_uzs: expense.rate_to_uzs,
          batch_id: expense.batch_id ?? '',
          batch_item_id: expense.batch_item_id ?? '',
          allocation_method: expense.allocation_method ?? '',
          payment_method: expense.payment_method,
          payment_status: expense.payment_status,
          due_date: expense.due_date ?? '',
          comment: expense.comment ?? '',
        }
      : {
          expense_date: todayIso(),
          category_id: '',
          amount: undefined as unknown as number,
          currency: 'UZS',
          rate_to_uzs: 1,
          batch_id: presetBatchId ?? '',
          batch_item_id: '',
          allocation_method: '',
          payment_method: 'transfer',
          payment_status: 'paid',
          due_date: '',
          comment: '',
        },
  })

  const w = useWatch({ control })
  const cat = db.categories.find((c) => c.id === w.category_id)
  const landed = cat?.cost_type === 'landed'
  const items = w.batch_id ? (derived.itemsByBatch.get(w.batch_id) ?? []) : []

  // Курс подставляется автоматически по валюте и дате операции (его можно исправить вручную).
  useEffect(() => {
    if (first.current) {
      first.current = false
      if (expense) return
    }
    if (w.currency === 'UZS') setValue('rate_to_uzs', 1)
    else {
      const r = rateFor(w.currency ?? 'UZS', w.expense_date ?? todayIso())
      if (r) setValue('rate_to_uzs', r)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.currency, w.expense_date])

  const uzs = w.amount && w.rate_to_uzs ? toUzs(w.amount, w.currency ?? 'UZS', w.rate_to_uzs) : null

  const submit = handleSubmit((v) =>
    run(async () => {
      await saveExpense(expense?.id ?? null, {
        expense_date: v.expense_date,
        category_id: v.category_id,
        amount: v.amount,
        currency: v.currency,
        rate_to_uzs: v.rate_to_uzs,
        batch_id: v.batch_id || null,
        batch_item_id: v.batch_item_id || null,
        allocation_method: (v.allocation_method || null) as Expense['allocation_method'],
        payment_method: v.payment_method,
        payment_status: v.payment_status,
        due_date: v.due_date || null,
        comment: v.comment.trim() || null,
      })
      onClose()
    }, expense ? 'Расход обновлён' : 'Расход добавлен'),
  )

  const expenseCats = db.categories.filter((c) => c.kind === 'expense')

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Дата *" error={errors.expense_date?.message}>
          <Input type="date" {...register('expense_date')} />
        </Field>
        <Field label="Категория *" error={errors.category_id?.message}>
          <Select {...register('category_id')} aria-invalid={!!errors.category_id}>
            <option value="">— выберите —</option>
            <optgroup label="Расходы партии (входят в себестоимость)">
              {expenseCats.filter((c) => c.cost_type === 'landed').map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
            <optgroup label="Операционные расходы">
              {expenseCats.filter((c) => c.cost_type !== 'landed').map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
          </Select>
        </Field>
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
          <Field label="Курс к UZS" error={errors.rate_to_uzs?.message} hint={w.currency !== 'UZS' ? 'Курс на дату операции' : undefined}>
            <Input type="number" step="0.0001" disabled={w.currency === 'UZS'} {...register('rate_to_uzs', { valueAsNumber: true })} />
          </Field>
        </div>
        {uzs && w.currency !== 'UZS' && (
          <p className="text-sm text-muted-foreground sm:col-span-2">
            Итого в UZS: <b className="num text-foreground">{formatUzs(uzs)}</b>
          </p>
        )}

        {cat && (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
            {landed
              ? 'Этот расход входит в себестоимость партии и распределяется между её товарами. В расходы периода он не попадает повторно.'
              : 'Операционный расход: учитывается в прибыли периода по дате расхода, в себестоимость партий не входит.'}
          </p>
        )}

        {landed && (
          <>
            <Field label="Партия *" className="sm:col-span-2">
              <Select {...register('batch_id', { onChange: () => setValue('batch_item_id', '') })} disabled={!!presetBatchId && !expense}>
                <option value="">— выберите партию —</option>
                {db.purchase_batches.map((b) => (
                  <option key={b.id} value={b.id}>{b.batch_no}</option>
                ))}
              </Select>
            </Field>
            <Field label="Относится к">
              <Select {...register('batch_item_id')} disabled={!w.batch_id}>
                <option value="">Ко всей партии (распределить)</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>{db.products.find((p) => p.id === it.product_id)?.name ?? 'Товар'}</option>
                ))}
              </Select>
            </Field>
            {!w.batch_item_id && (
              <Field label="Метод распределения">
                <Select {...register('allocation_method')}>
                  <option value="">Как в партии</option>
                  {Object.entries(ALLOCATION_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        )}

        <Field label="Способ оплаты">
          <Select {...register('payment_method')}>
            {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </Field>
        <Field label="Статус оплаты">
          <Select {...register('payment_status')}>
            <option value="paid">Оплачено</option>
            <option value="pending">К оплате (обязательство)</option>
          </Select>
        </Field>
        {w.payment_status === 'pending' && (
          <Field label="Срок оплаты" error={errors.due_date?.message}>
            <Input type="date" {...register('due_date')} />
          </Field>
        )}
        <Field label="Комментарий" className="sm:col-span-2">
          <Textarea rows={2} {...register('comment')} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Отмена</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
      </DialogFooter>
    </form>
  )
}

import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useFieldArray, useForm, useWatch, type Control, type UseFormSetValue } from 'react-hook-form'
import { z } from 'zod'
import { KeyValue, Money, Notice } from '@/components/common'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { saveSale } from '@/data/actions'
import { useAppState } from '@/data/store'
import { useAction } from '@/hooks/use-action'
import { sellingParamsFor } from '@/lib/calc/derive'
import { SALE_STATUS_LABEL } from '@/lib/constants'
import { todayIso } from '@/lib/format'
import { D, roundUzs } from '@/lib/money'
import type { Db, Sale, SaleItem } from '@/types/db'

const nonNeg = z.number({ error: 'Введите число' }).min(0, 'Не может быть отрицательным')
const itemSchema = z.object({
  id: z.string().optional(),
  product_id: z.string().min(1, 'Выберите товар'),
  qty: z.number({ error: 'Введите число' }).int('Целое число').min(1, 'Минимум 1'),
  unit_price_uzs: z.number({ error: 'Введите цену' }).positive('Цена должна быть больше нуля'),
  seller_discount_uzs: nonNeg,
  commission_pct: z.number().min(0).max(100, 'Не более 100%').nullable(),
  commission_uzs: nonNeg,
  logistics_uzs: nonNeg,
  ads_uzs: nonNeg,
  other_deductions_uzs: nonNeg,
  packaging_uzs: nonNeg,
  extra_cost_uzs: nonNeg,
})
const schema = z.object({
  order_no: z.string().trim().min(1, 'Укажите номер заказа'),
  sale_date: z.string().min(1, 'Укажите дату'),
  status: z.enum(['in_progress', 'completed', 'cancelled']),
  payout_actual_uzs: z.number().min(0).nullable(),
  payout_received_date: z.string(),
  notes: z.string(),
  items: z.array(itemSchema).min(1, 'Добавьте хотя бы один товар'),
})
type Values = z.infer<typeof schema>
type ItemValues = z.infer<typeof itemSchema>

const nullableNum = (v: unknown) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v))

function fillFromTariffs(db: Db, it: ItemValues, date: string, productId: string, withPct: boolean): Partial<ItemValues> {
  const p = db.products.find((x) => x.id === productId)
  const sp = sellingParamsFor(db, p, date)
  const pct = withPct ? sp.commissionPct : (it.commission_pct ?? sp.commissionPct)
  const revenue = D(it.unit_price_uzs).mul(it.qty).minus(it.seller_discount_uzs)
  return {
    commission_pct: pct,
    commission_uzs: roundUzs(revenue.mul(pct).div(100)).toNumber(),
    logistics_uzs: roundUzs(D(sp.logistics).mul(it.qty)).toNumber(),
    other_deductions_uzs: roundUzs(revenue.mul(sp.otherPct).div(100).plus(sp.otherFixed)).toNumber(),
    packaging_uzs: roundUzs(D(sp.packaging).mul(it.qty)).toNumber(),
    extra_cost_uzs: roundUzs(D(sp.extra).mul(it.qty)).toNumber(),
  }
}

function ItemRow({
  index,
  control,
  setValue,
  errors,
  register,
  onRemove,
  initialManual,
  date,
}: {
  index: number
  control: Control<Values>
  setValue: UseFormSetValue<Values>
  errors: ReturnType<typeof useForm<Values>>['formState']['errors']
  register: ReturnType<typeof useForm<Values>>['register']
  onRemove: () => void
  initialManual: boolean
  date: string
}) {
  const { db } = useAppState()
  const [manual, setManual] = useState(initialManual)
  const it = useWatch({ control, name: `items.${index}` })
  const e = errors.items?.[index]
  const p = db.products.find((x) => x.id === it?.product_id)

  // Автозаполнение комиссии и удержаний по тарифам, пока пользователь не правил суммы вручную.
  useEffect(() => {
    if (manual || !it?.product_id) return
    const patch = fillFromTariffs(db, it as ItemValues, date, it.product_id, false)
    for (const [k, v] of Object.entries(patch)) {
      const key = `items.${index}.${k}` as `items.${number}.qty`
      setValue(key, v as never, { shouldDirty: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual, it?.product_id, it?.qty, it?.unit_price_uzs, it?.seller_discount_uzs, it?.commission_pct, date])

  const num = (name: string, opts: object = {}) =>
    register(`items.${index}.${name}` as `items.${number}.qty`, { valueAsNumber: true, ...opts })
  const manualNum = (name: string) => num(name, { onChange: () => setManual(true) })

  const revenue = D(it?.unit_price_uzs).mul(it?.qty ?? 0).minus(it?.seller_discount_uzs ?? 0)
  const payout = revenue.minus(it?.commission_uzs ?? 0).minus(it?.logistics_uzs ?? 0).minus(it?.other_deductions_uzs ?? 0)

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Select
            aria-label="Товар"
            {...register(`items.${index}.product_id`, {
              onChange: (ev) => {
                const prod = db.products.find((x) => x.id === ev.target.value)
                if (prod) {
                  setValue(`items.${index}.unit_price_uzs`, prod.sale_price_uzs)
                  const sp = sellingParamsFor(db, prod, date)
                  setValue(`items.${index}.commission_pct`, sp.commissionPct)
                  setManual(false)
                }
              },
            })}
            aria-invalid={!!e?.product_id}
          >
            <option value="">— выберите товар —</option>
            {db.products.filter((x) => x.status === 'active' || x.id === it?.product_id).map((x) => (
              <option key={x.id} value={x.id}>{x.name} ({x.sku})</option>
            ))}
          </Select>
          {e?.product_id?.message && <p className="mt-1 text-xs text-danger">{e.product_id.message}</p>}
        </div>
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Убрать позицию"><Trash2 className="text-danger" /></Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Количество" error={e?.qty?.message}><Input type="number" {...num('qty')} /></Field>
        <Field label="Цена продажи, UZS" error={e?.unit_price_uzs?.message}><Input type="number" {...num('unit_price_uzs')} /></Field>
        <Field label="Скидка продавца, UZS" error={e?.seller_discount_uzs?.message}><Input type="number" {...num('seller_discount_uzs')} /></Field>
        <Field label="Комиссия, %" error={e?.commission_pct?.message}>
          <Input type="number" step="0.1" {...register(`items.${index}.commission_pct`, { setValueAs: nullableNum, onChange: () => setManual(false) })} />
        </Field>
        <Field label="Комиссия, UZS" error={e?.commission_uzs?.message}><Input type="number" {...manualNum('commission_uzs')} /></Field>
        <Field label="Логистика/обработка, UZS" error={e?.logistics_uzs?.message}><Input type="number" {...manualNum('logistics_uzs')} /></Field>
        <Field label="Прочие удержания, UZS" error={e?.other_deductions_uzs?.message}><Input type="number" {...manualNum('other_deductions_uzs')} /></Field>
        <Field label="Реклама, UZS" error={e?.ads_uzs?.message}><Input type="number" {...manualNum('ads_uzs')} /></Field>
        <Field label="Упаковка, UZS" error={e?.packaging_uzs?.message}><Input type="number" {...manualNum('packaging_uzs')} /></Field>
        <Field label="Прочие расходы, UZS" error={e?.extra_cost_uzs?.message}><Input type="number" {...manualNum('extra_cost_uzs')} /></Field>
        <div className="col-span-2 flex items-end justify-between gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Ожидаемая выплата по позиции</div>
            <Money value={payout} className="font-semibold" />
          </div>
          {manual && p && (
            <Button size="sm" variant="outline" onClick={() => setManual(false)} title="Пересчитать комиссию и удержания по тарифам">
              <RefreshCw /> По тарифам
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function SaleForm({ sale, onClose }: { sale: Sale | null; onClose: () => void }) {
  const { db } = useAppState()
  const { busy, run } = useAction()
  const existing: SaleItem[] = sale ? db.sale_items.filter((i) => i.sale_id === sale.id) : []

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: sale
      ? {
          order_no: sale.order_no,
          sale_date: sale.sale_date,
          status: sale.status,
          payout_actual_uzs: sale.payout_actual_uzs,
          payout_received_date: sale.payout_received_date ?? '',
          notes: sale.notes ?? '',
          items: existing.map((i) => ({
            id: i.id,
            product_id: i.product_id,
            qty: i.qty,
            unit_price_uzs: i.unit_price_uzs,
            seller_discount_uzs: i.seller_discount_uzs,
            commission_pct: i.commission_pct,
            commission_uzs: i.commission_uzs,
            logistics_uzs: i.logistics_uzs,
            ads_uzs: i.ads_uzs,
            other_deductions_uzs: i.other_deductions_uzs,
            packaging_uzs: i.packaging_uzs,
            extra_cost_uzs: i.extra_cost_uzs,
          })),
        }
      : {
          order_no: '',
          sale_date: todayIso(),
          status: 'completed',
          payout_actual_uzs: null,
          payout_received_date: '',
          notes: '',
          items: [],
        },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const w = useWatch({ control })

  const submit = handleSubmit((v) =>
    run(async () => {
      await saveSale(
        sale?.id ?? null,
        {
          order_no: v.order_no,
          sale_date: v.sale_date,
          status: v.status,
          payout_actual_uzs: v.status === 'completed' ? v.payout_actual_uzs : null,
          payout_received_date: v.payout_received_date || null,
          notes: v.notes.trim() || null,
        },
        v.items.map((i) => ({ ...i, commission_pct: i.commission_pct ?? null })),
      )
      onClose()
    }, sale ? 'Заказ обновлён' : 'Заказ добавлен'),
  )

  const total = (w.items ?? []).reduce(
    (s, i) => s.plus(D(i?.unit_price_uzs).mul(i?.qty ?? 0).minus(i?.seller_discount_uzs ?? 0).minus(i?.commission_uzs ?? 0).minus(i?.logistics_uzs ?? 0).minus(i?.other_deductions_uzs ?? 0)),
    D(0),
  )

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Номер заказа *" error={errors.order_no?.message}><Input {...register('order_no')} aria-invalid={!!errors.order_no} /></Field>
        <Field label="Дата продажи *" error={errors.sale_date?.message}><Input type="date" {...register('sale_date')} /></Field>
        <Field label="Статус">
          <Select {...register('status')}>
            {Object.entries(SALE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
      </div>
      {w.status === 'cancelled' && <Notice tone="warning" className="mt-3">Отменённый заказ не считается продажей: выручка, склад и прибыль не меняются.</Notice>}
      {w.status === 'in_progress' && <Notice tone="primary" className="mt-3">Заказ в работе резервирует товар на складе, но ещё не входит в выручку.</Notice>}

      <h3 className="mb-2 mt-5 text-sm font-semibold">Позиции заказа</h3>
      {errors.items?.message && <Notice tone="danger" className="mb-2">{errors.items.message}</Notice>}
      <div className="space-y-3">
        {fields.map((f, i) => (
          <ItemRow
            key={f.id}
            index={i}
            control={control}
            setValue={setValue}
            errors={errors}
            register={register}
            onRemove={() => remove(i)}
            initialManual={!!sale}
            date={w.sale_date ?? todayIso()}
          />
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() =>
          append({
            product_id: '', qty: 1, unit_price_uzs: undefined as unknown as number, seller_discount_uzs: 0, commission_pct: null, commission_uzs: 0,
            logistics_uzs: 0, ads_uzs: 0, other_deductions_uzs: 0, packaging_uzs: 0, extra_cost_uzs: 0,
          })
        }
      >
        <Plus /> Добавить позицию
      </Button>

      {w.status === 'completed' && (
        <div className="mt-5 grid gap-3 rounded-lg bg-muted/60 p-3 sm:grid-cols-3">
          <div>
            <KeyValue rows={[{ label: 'Ожидаемая выплата', value: <Money value={total} className="font-semibold" /> }]} />
          </div>
          <Field label="Фактическая выплата, UZS" hint="Пусто — берётся ожидаемая выплата" error={errors.payout_actual_uzs?.message}>
            <Input type="number" {...register('payout_actual_uzs', { setValueAs: nullableNum })} />
          </Field>
          <Field label="Дата поступления выплаты" hint="Пусто — выплата ещё не получена (дебиторка)">
            <Input type="date" {...register('payout_received_date')} />
          </Field>
        </div>
      )}
      <Field label="Заметки" className="mt-3"><Textarea rows={2} {...register('notes')} /></Field>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Отмена</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
      </DialogFooter>
    </form>
  )
}

import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { Notice } from '@/components/common'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { saveBatch, latestRate } from '@/data/actions'
import { useAppState } from '@/data/store'
import { useAction } from '@/hooks/use-action'
import { ALLOCATION_LABEL, BATCH_STATUSES, BATCH_STATUS_LABEL } from '@/lib/constants'
import { formatNumber, todayIso } from '@/lib/format'
import type { PurchaseBatch } from '@/types/db'
import { kgToG, gToKg } from '@/lib/weight'

const int = (msg = 'Целое число ≥ 0') => z.number({ error: 'Введите число' }).int(msg).min(0, msg)
const nonNeg = z.number({ error: 'Введите число' }).min(0, 'Не может быть отрицательным')

const itemSchema = z.object({
  id: z.string().optional(),
  product_id: z.string().min(1, 'Выберите товар'),
  qty_ordered: z.number({ error: 'Введите число' }).int('Целое число').min(1, 'Минимум 1'),
  qty_received: int(),
  qty_defective: int(),
  unit_price_cny: nonNeg,
  unit_weight_g: nonNeg,
  unit_volume_m3: nonNeg,
  planned_sale_price_uzs: nonNeg,
})

const schema = z
  .object({
    batch_no: z.string().trim().min(1, 'Укажите номер партии'),
    order_date: z.string().min(1, 'Укажите дату заказа'),
    received_date: z.string(),
    supplier_id: z.string(),
    order_url: z.union([z.literal(''), z.url('Некорректная ссылка')]),
    status: z.enum(['ordered', 'paid', 'shipped', 'in_transit', 'customs', 'received', 'selling', 'closed']),
    cny_rate: z.number({ error: 'Введите курс' }).positive('Курс должен быть больше нуля'),
    prepayment_cny: nonNeg,
    allocation_method: z.enum(['quantity', 'value', 'weight', 'volume']),
    actual_weight_g: nonNeg,
    volume_m3: nonNeg,
    cargo_tariff_kg: nonNeg,
    cargo_tariff_m3: nonNeg,
    cargo_currency: z.enum(['UZS', 'CNY', 'USD']),
    notes: z.string(),
    items: z.array(itemSchema).min(1, 'Добавьте хотя бы один товар'),
  })
  .superRefine((v, ctx) => {
    v.items.forEach((it, i) => {
      if (it.qty_defective > it.qty_received)
        ctx.addIssue({ code: 'custom', path: ['items', i, 'qty_defective'], message: 'Брак больше полученного' })
    })
    const ids = v.items.map((i) => i.product_id).filter(Boolean)
    ids.forEach((id, i) => {
      if (ids.indexOf(id) !== i) ctx.addIssue({ code: 'custom', path: ['items', i, 'product_id'], message: 'Товар уже добавлен' })
    })
  })
type Values = z.infer<typeof schema>

function nextBatchNo(existing: string[]): string {
  const year = new Date().getFullYear()
  const prefix = `П-${year}-`
  let max = 0
  for (const n of existing) {
    if (n.startsWith(prefix)) max = Math.max(max, Number(n.slice(prefix.length)) || 0)
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

export function BatchForm({ batch, onClose, onSaved }: { batch: PurchaseBatch | null; onClose: () => void; onSaved?: (b: PurchaseBatch) => void }) {
  const { db } = useAppState()
  const { busy, run } = useAction()
  const existingItems = batch ? db.purchase_batch_items.filter((i) => i.batch_id === batch.id) : []

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: batch
      ? {
          batch_no: batch.batch_no,
          order_date: batch.order_date,
          received_date: batch.received_date ?? '',
          supplier_id: batch.supplier_id ?? '',
          order_url: batch.order_url ?? '',
          status: batch.status,
          cny_rate: batch.cny_rate,
          prepayment_cny: batch.prepayment_cny,
          allocation_method: batch.allocation_method,
          actual_weight_g: kgToG(batch.actual_weight_kg),
          volume_m3: batch.volume_m3,
          cargo_tariff_kg: batch.cargo_tariff_kg,
          cargo_tariff_m3: batch.cargo_tariff_m3,
          cargo_currency: batch.cargo_currency,
          notes: batch.notes ?? '',
          items: existingItems.map((i) => ({
            id: i.id,
            product_id: i.product_id,
            qty_ordered: i.qty_ordered,
            qty_received: i.qty_received,
            qty_defective: i.qty_defective,
            unit_price_cny: i.unit_price_cny,
            unit_weight_g: kgToG(i.unit_weight_kg),
            unit_volume_m3: i.unit_volume_m3,
            planned_sale_price_uzs: i.planned_sale_price_uzs,
          })),
        }
      : {
          batch_no: nextBatchNo(db.purchase_batches.map((b) => b.batch_no)),
          order_date: todayIso(),
          received_date: '',
          supplier_id: '',
          order_url: '',
          status: 'ordered',
          cny_rate: latestRate('CNY_UZS') ?? (undefined as unknown as number),
          prepayment_cny: 0,
          allocation_method: 'weight',
          actual_weight_g: 0,
          volume_m3: 0,
          cargo_tariff_kg: 0,
          cargo_tariff_m3: 0,
          cargo_currency: 'USD',
          notes: '',
          items: [],
        },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const w = useWatch({ control })

  const received = ['received', 'selling', 'closed'].includes(w.status ?? '')
  // При переходе в «получена» количество полученного по умолчанию равно заказанному — его можно исправить.
  useEffect(() => {
    if (!received) return
    const items = getValues('items')
    if (items.length && items.every((i) => !i.qty_received)) {
      items.forEach((it, idx) => setValue(`items.${idx}.qty_received`, it.qty_ordered || 0))
    }
    if (!getValues('received_date')) setValue('received_date', todayIso())
  }, [received, getValues, setValue])

  const addProduct = (id: string) => {
    const p = db.products.find((x) => x.id === id)
    if (!p) return
    append({
      product_id: p.id,
      qty_ordered: 1,
      qty_received: 0,
      qty_defective: 0,
      unit_price_cny: p.purchase_price_cny,
      unit_weight_g: kgToG(p.weight_kg),
      unit_volume_m3: p.volume_m3,
      planned_sale_price_uzs: p.sale_price_uzs,
    })
  }

  const totalWeight = (w.items ?? []).reduce((s, i) => s + (i?.unit_weight_g ?? 0) * (i?.qty_ordered ?? 0), 0)

  const submit = handleSubmit((v) =>
    run(async () => {
      const saved = await saveBatch(
        batch?.id ?? null,
        {
          batch_no: v.batch_no,
          order_date: v.order_date,
          received_date: v.received_date || null,
          supplier_id: v.supplier_id || null,
          order_url: v.order_url || null,
          status: v.status,
          cny_rate: v.cny_rate,
          prepayment_cny: v.prepayment_cny,
          allocation_method: v.allocation_method,
          actual_weight_kg: gToKg(v.actual_weight_g),
          volume_m3: v.volume_m3,
          cargo_tariff_kg: v.cargo_tariff_kg,
          cargo_tariff_m3: v.cargo_tariff_m3,
          cargo_currency: v.cargo_currency,
          notes: v.notes.trim() || null,
        },
        v.items.map(({ unit_weight_g, ...it }) => ({ ...it, unit_weight_kg: gToKg(unit_weight_g) })),
      )
      onSaved?.(saved)
      onClose()
    }, batch ? 'Партия обновлена' : 'Партия создана'),
  )

  const usedIds = new Set((w.items ?? []).map((i) => i?.product_id))
  const num = (name: Parameters<typeof register>[0]) => register(name, { valueAsNumber: true })

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Номер партии *" error={errors.batch_no?.message}>
          <Input {...register('batch_no')} aria-invalid={!!errors.batch_no} />
        </Field>
        <Field label="Дата заказа *" error={errors.order_date?.message}>
          <Input type="date" {...register('order_date')} />
        </Field>
        <Field label="Статус">
          <Select {...register('status')}>
            {BATCH_STATUSES.map((s) => (
              <option key={s} value={s}>{BATCH_STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Поставщик">
          <Select {...register('supplier_id')}>
            <option value="">— не выбран —</option>
            {db.suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Ссылка на заказ" error={errors.order_url?.message} className="sm:col-span-2">
          <Input {...register('order_url')} placeholder="https://…" />
        </Field>
        <Field label="Курс CNY/UZS на момент закупки *" error={errors.cny_rate?.message} hint="Фиксируется в партии и не меняется при смене курса в настройках">
          <Input type="number" step="0.0001" {...num('cny_rate')} aria-invalid={!!errors.cny_rate} />
        </Field>
        <Field label="Предоплата поставщику, CNY" error={errors.prepayment_cny?.message}>
          <Input type="number" step="0.01" {...num('prepayment_cny')} />
        </Field>
        {received && (
          <Field label="Дата получения">
            <Input type="date" {...register('received_date')} />
          </Field>
        )}
      </div>

      <h3 className="mb-2 mt-5 text-sm font-semibold">Товары в партии</h3>
      {errors.items?.message && <Notice tone="danger" className="mb-2">{errors.items.message}</Notice>}
      <div className="space-y-3">
        {fields.map((f, i) => {
          const e = errors.items?.[i]
          const p = db.products.find((x) => x.id === w.items?.[i]?.product_id)
          return (
            <div key={f.id} className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-sm font-medium">
                  {p?.name ?? 'Товар'} <span className="text-xs font-normal text-muted-foreground">{p?.sku}</span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(i)} aria-label="Убрать товар">
                  <Trash2 className="text-danger" />
                </Button>
              </div>
              {e?.product_id?.message && <p className="mb-1 text-xs text-danger">{e.product_id.message}</p>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Field label="Заказано, шт." error={e?.qty_ordered?.message}>
                  <Input type="number" {...num(`items.${i}.qty_ordered`)} />
                </Field>
                <Field label="Получено, шт." error={e?.qty_received?.message}>
                  <Input type="number" {...num(`items.${i}.qty_received`)} />
                </Field>
                <Field label="Брак, шт." error={e?.qty_defective?.message}>
                  <Input type="number" {...num(`items.${i}.qty_defective`)} />
                </Field>
                <Field label="Цена, CNY" error={e?.unit_price_cny?.message}>
                  <Input type="number" step="0.01" {...num(`items.${i}.unit_price_cny`)} />
                </Field>
                <Field label="Вес ед., г" error={e?.unit_weight_g?.message}>
                  <Input type="number" step="1" {...num(`items.${i}.unit_weight_g`)} />
                </Field>
                <Field label="Объём ед., м³" error={e?.unit_volume_m3?.message}>
                  <Input type="number" step="0.0001" {...num(`items.${i}.unit_volume_m3`)} />
                </Field>
                <Field label="Плановая цена Uzum, UZS" error={e?.planned_sale_price_uzs?.message} className="col-span-2">
                  <Input type="number" {...num(`items.${i}.planned_sale_price_uzs`)} />
                </Field>
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Select
          aria-label="Добавить товар"
          value=""
          onChange={(e) => {
            if (e.target.value) addProduct(e.target.value)
          }}
          className="max-w-xs"
        >
          <option value="">+ Добавить товар…</option>
          {db.products.filter((p) => p.status === 'active' && !usedIds.has(p.id)).map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
          ))}
        </Select>
        {db.products.length === 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><Plus className="size-3" /> Сначала создайте товары</span>
        )}
      </div>

      <h3 className="mb-2 mt-5 text-sm font-semibold">Карго и распределение расходов</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Фактический вес груза, г" error={errors.actual_weight_g?.message} hint={totalWeight > 0 ? `По товарам: ${formatNumber(totalWeight, 0)} г` : undefined}>
          <Input type="number" step="1" {...num('actual_weight_g')} />
        </Field>
        <Field label="Объём груза, м³" error={errors.volume_m3?.message}>
          <Input type="number" step="0.001" {...num('volume_m3')} />
        </Field>
        <Field label="Валюта тарифа карго">
          <Select {...register('cargo_currency')}>
            <option value="USD">USD</option>
            <option value="CNY">CNY</option>
            <option value="UZS">UZS</option>
          </Select>
        </Field>
        <Field label="Тариф за кг">
          <Input type="number" step="0.01" {...num('cargo_tariff_kg')} />
        </Field>
        <Field label="Тариф за м³">
          <Input type="number" step="0.01" {...num('cargo_tariff_m3')} />
        </Field>
        <Field label="Метод распределения общих расходов">
          <Select {...register('allocation_method')}>
            {Object.entries(ALLOCATION_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </Field>
        <Field label="Заметки" className="sm:col-span-3">
          <Textarea rows={2} {...register('notes')} />
        </Field>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Сами расходы (карго, таможня, посредник и т. д.) добавляются на странице партии — каждый со своей суммой, валютой, датой и комментарием.
      </p>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Отмена</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить партию'}</Button>
      </DialogFooter>
    </form>
  )
}

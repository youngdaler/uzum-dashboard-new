import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { Notice } from '@/components/common'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form'
import { returnedQty, saveReturn } from '@/data/actions'
import { useAppState } from '@/data/store'
import { useAction } from '@/hooks/use-action'
import { todayIso } from '@/lib/format'
import { D, roundUzs } from '@/lib/money'
import type { ReturnRow } from '@/types/db'

const nonNeg = z.number({ error: 'Введите число' }).min(0, 'Не может быть отрицательным')
const schema = z.object({
  sale_item_id: z.string().min(1, 'Выберите позицию заказа'),
  return_date: z.string().min(1, 'Укажите дату'),
  kind: z.enum(['return', 'damaged']),
  qty: z.number({ error: 'Введите число' }).int('Целое число').min(1, 'Минимум 1'),
  restock: z.boolean(),
  refund_uzs: nonNeg,
  commission_refund_uzs: nonNeg,
  return_logistics_uzs: nonNeg,
  compensation_uzs: nonNeg,
  note: z.string(),
})
type Values = z.infer<typeof schema>

export function ReturnForm({ ret, presetSaleItemId, onClose }: { ret: ReturnRow | null; presetSaleItemId?: string; onClose: () => void }) {
  const { db } = useAppState()
  const { busy, run } = useAction()
  const touched = useRef(!!ret)

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: ret
      ? {
          sale_item_id: ret.sale_item_id,
          return_date: ret.return_date,
          kind: ret.kind,
          qty: ret.qty,
          restock: ret.restock,
          refund_uzs: ret.refund_uzs,
          commission_refund_uzs: ret.commission_refund_uzs,
          return_logistics_uzs: ret.return_logistics_uzs,
          compensation_uzs: ret.compensation_uzs,
          note: ret.note ?? '',
        }
      : {
          sale_item_id: presetSaleItemId ?? '',
          return_date: todayIso(),
          kind: 'return',
          qty: 1,
          restock: true,
          refund_uzs: 0,
          commission_refund_uzs: 0,
          return_logistics_uzs: 0,
          compensation_uzs: 0,
          note: '',
        },
  })
  const w = useWatch({ control })

  const completedItems = db.sale_items.filter((i) => db.sales.find((s) => s.id === i.sale_id)?.status === 'completed')
  const item = db.sale_items.find((i) => i.id === w.sale_item_id)
  const sale = item ? db.sales.find((s) => s.id === item.sale_id) : undefined
  const already = item ? returnedQty(item.id, ret?.id) : 0
  const maxQty = item ? item.qty - already : 0

  // Предлагаем возврат пропорционально проданному; пользователь может изменить суммы.
  useEffect(() => {
    if (touched.current || !item || !w.qty) return
    const share = D(w.qty).div(item.qty)
    const net = D(item.unit_price_uzs).mul(item.qty).minus(item.seller_discount_uzs)
    setValue('refund_uzs', roundUzs(net.mul(share)).toNumber())
    setValue('commission_refund_uzs', roundUzs(D(item.commission_uzs).mul(share)).toNumber())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, w.qty])

  useEffect(() => {
    if (w.kind === 'damaged' && w.restock) setValue('restock', false)
  }, [w.kind, w.restock, setValue])

  const submit = handleSubmit((v) =>
    run(async () => {
      await saveReturn(ret?.id ?? null, { ...v, note: v.note.trim() || null })
      onClose()
    }, ret ? 'Возврат обновлён' : 'Возврат оформлен'),
  )

  const mark = { onChange: () => (touched.current = true) }

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Позиция заказа *" error={errors.sale_item_id?.message} className="sm:col-span-2">
          <Select {...register('sale_item_id', { onChange: () => (touched.current = false) })} disabled={!!ret || !!presetSaleItemId}>
            <option value="">— выберите —</option>
            {completedItems.map((i) => (
              <option key={i.id} value={i.id}>
                {db.sales.find((s) => s.id === i.sale_id)?.order_no} · {db.products.find((p) => p.id === i.product_id)?.name} · {i.qty} шт.
              </option>
            ))}
          </Select>
        </Field>
        {item && (
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Заказ {sale?.order_no}: продано {item.qty} шт., уже возвращено {already}, доступно к возврату {maxQty}.
          </p>
        )}
        <Field label="Дата возврата *" error={errors.return_date?.message}><Input type="date" {...register('return_date')} /></Field>
        <Field label="Тип">
          <Select {...register('kind')}>
            <option value="return">Возврат покупателем</option>
            <option value="damaged">Повреждённый товар</option>
          </Select>
        </Field>
        <Field label="Количество, шт." error={errors.qty?.message}>
          <Input type="number" {...register('qty', { valueAsNumber: true, onChange: () => (touched.current = false) })} />
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox label="Вернуть на склад как годный" {...register('restock')} disabled={w.kind === 'damaged'} />
        </div>
        <Field label="Возврат денег покупателю, UZS" error={errors.refund_uzs?.message}><Input type="number" {...register('refund_uzs', { valueAsNumber: true, ...mark })} /></Field>
        <Field label="Возврат комиссии Uzum, UZS" error={errors.commission_refund_uzs?.message}><Input type="number" {...register('commission_refund_uzs', { valueAsNumber: true, ...mark })} /></Field>
        <Field label="Логистика возврата, UZS" error={errors.return_logistics_uzs?.message}><Input type="number" {...register('return_logistics_uzs', { valueAsNumber: true })} /></Field>
        <Field label="Компенсация от Uzum, UZS" error={errors.compensation_uzs?.message} hint="Например, за повреждённый товар"><Input type="number" {...register('compensation_uzs', { valueAsNumber: true })} /></Field>
        <Field label="Комментарий" className="sm:col-span-2"><Textarea rows={2} {...register('note')} /></Field>
      </div>
      {w.kind === 'damaged' && (
        <Notice tone="warning" className="mt-3">Повреждённые единицы на склад не возвращаются: их себестоимость остаётся в себестоимости проданного, а деньги покупателю возвращаются — убыток отразится в прибыли периода.</Notice>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Отмена</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
      </DialogFooter>
    </form>
  )
}

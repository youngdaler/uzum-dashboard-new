import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, ClipboardCheck, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { DataTable, type Column } from '@/components/data-table'
import { EmptyState, KeyValue, Money, Notice, PageHeader, Pct } from '@/components/common'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter, useConfirm } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/form'
import { deleteEvaluation, saveEvaluation } from '@/data/actions'
import { useAppState } from '@/data/store'
import { useAction } from '@/hooks/use-action'
import { evaluate, type EvaluationResult } from '@/lib/calc/evaluate'
import { formatNumber, formatUzs } from '@/lib/format'
import { latestRateOf } from '@/lib/productStats'
import type { ProductEvaluation } from '@/types/db'
import { kgToG, gToKg } from '@/lib/weight'

const nullableNum = (x: unknown) => (x === '' || x === null || x === undefined || Number.isNaN(Number(x)) ? null : Number(x))
const num = (label: string, min = 0) => z.number({ error: `Введите: ${label}` }).min(min, `Не меньше ${min}`)

const schema = z.object({
  name: z.string().trim().min(1, 'Введите название'),
  supplier_price_cny: num('цена поставщика'),
  moq: z.number({ error: 'Введите MOQ' }).int('Только целое число').min(1, 'Минимум 1'),
  cny_rate: num('курс'),
  unit_weight_g: num('вес'),
  delivery_per_unit_uzs: num('доставка'),
  sale_price_uzs: num('цена продажи'),
  commission_pct: z.number({ error: 'Введите комиссию' }).min(0).max(100, 'Не больше 100'),
  selling_costs_per_unit_uzs: num('расходы'),
  monthly_sales: z.number().min(0).nullable(),
  defect_return_pct: z.number({ error: 'Введите риск' }).min(0).max(100, 'Не больше 100'),
  budget_uzs: z.number().min(0).nullable(),
  notes: z.string(),
})
type Values = z.infer<typeof schema>

const asRow = ({ unit_weight_g, ...v }: Values): ProductEvaluation => ({ ...v, unit_weight_kg: gToKg(unit_weight_g), notes: v.notes || null, id: '', user_id: '', created_at: '', updated_at: '', is_demo: false })

function EvaluationForm({ item, onClose }: { item: ProductEvaluation | null; onClose: () => void }) {
  const { db } = useAppState()
  const { busy, run } = useAction()
  const defaults: Values = item
    ? { name: item.name, supplier_price_cny: item.supplier_price_cny, moq: item.moq, cny_rate: item.cny_rate, unit_weight_g: kgToG(item.unit_weight_kg), delivery_per_unit_uzs: item.delivery_per_unit_uzs, sale_price_uzs: item.sale_price_uzs, commission_pct: item.commission_pct, selling_costs_per_unit_uzs: item.selling_costs_per_unit_uzs, monthly_sales: item.monthly_sales, defect_return_pct: item.defect_return_pct, budget_uzs: item.budget_uzs, notes: item.notes ?? '' }
    : { name: '', supplier_price_cny: 0, moq: 100, cny_rate: latestRateOf(db, 'CNY_UZS') ?? 0, unit_weight_g: 0, delivery_per_unit_uzs: 0, sale_price_uzs: 0, commission_pct: db.marketplace_fee_settings.find((f) => f.category_id === null)?.commission_pct ?? 0, selling_costs_per_unit_uzs: 0, monthly_sales: null, defect_return_pct: 3, budget_uzs: null, notes: '' }
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults })
  const w = useWatch({ control })
  const preview = useMemo(() => {
    const parsed = schema.safeParse({ ...defaults, ...w })
    return parsed.success ? evaluate(asRow(parsed.data)) : null
    // eslint-disable-next-line
  }, [w])

  const onSubmit = handleSubmit(async (v) => {
    const { notes, unit_weight_g, ...rest } = v
    const ok = await run(() => saveEvaluation(item?.id ?? null, { ...rest, unit_weight_kg: gToKg(unit_weight_g), notes: notes.trim() || null }), 'Сохранено')
    if (ok) onClose()
  })

  const f = (k: keyof Values, label: string, extra?: { hint?: string; nullable?: boolean; step?: string }) => (
    <Field label={label} error={errors[k]?.message as string | undefined} hint={extra?.hint}>
      <Input type="number" step={extra?.step ?? 'any'} min="0" {...register(k, extra?.nullable ? { setValueAs: nullableNum } : { valueAsNumber: true })} />
    </Field>
  )

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название товара" error={errors.name?.message} className="sm:col-span-2"><Input {...register('name')} /></Field>
        {f('supplier_price_cny', 'Цена поставщика, CNY')}
        {f('moq', 'MOQ — минимальная партия, шт.', { step: '1' })}
        {f('cny_rate', 'Курс CNY/UZS')}
        {f('unit_weight_g', 'Вес единицы, г', { hint: 'Для справки при расчёте доставки.' })}
        {f('delivery_per_unit_uzs', 'Доставка на единицу, UZS', { hint: 'Вес × тариф карго за кг + прочая логистика.' })}
        {f('sale_price_uzs', 'Ожидаемая цена на Uzum, UZS')}
        {f('commission_pct', 'Комиссия Uzum, %')}
        {f('selling_costs_per_unit_uzs', 'Прочие расходы реализации на единицу, UZS', { hint: 'Логистика Uzum, упаковка, реклама.' })}
        {f('monthly_sales', 'Ожидаемые продажи в месяц, шт.', { nullable: true, hint: 'Без этого нельзя оценить срок реализации.' })}
        {f('defect_return_pct', 'Риск брака и возвратов, %')}
        {f('budget_uzs', 'Бюджет на закупку, UZS', { nullable: true })}
        <Field label="Заметки" className="sm:col-span-2"><Textarea rows={2} {...register('notes')} /></Field>
      </div>
      {preview && (
        <div className="mt-4 rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Предварительный расчёт</div>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <KeyValue rows={[{ label: 'Нужный капитал', value: formatUzs(preview.capital) }, { label: 'Чистая прибыль с партии', value: <Money value={preview.netProfit} signed /> }]} />
            <KeyValue rows={[{ label: 'ROI', value: <Pct value={preview.roiPct} /> }, { label: 'Маржинальность', value: <Pct value={preview.marginPct} /> }]} />
          </div>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Отмена</Button>
        <Button type="submit" disabled={busy}>Сохранить</Button>
      </DialogFooter>
    </form>
  )
}

interface Row {
  e: ProductEvaluation
  r: EvaluationResult
}

export default function Evaluation() {
  const { db } = useAppState()
  const confirm = useConfirm()
  const { run } = useAction()
  const [editing, setEditing] = useState<ProductEvaluation | 'new' | null>(null)

  const rows = useMemo<Row[]>(() => db.product_evaluations.map((e) => ({ e, r: evaluate(e) })), [db.product_evaluations])

  const columns: Column<Row>[] = [
    { key: 'name', header: 'Товар', sort: (x) => x.e.name, csv: (x) => x.e.name, cell: (x) => (<div><div className="font-medium">{x.e.name}</div>{x.r.warnings.length > 0 && <div className="mt-0.5 flex items-center gap-1 text-xs text-warning" title={x.r.warnings.join('\n')}><AlertTriangle className="size-3" />{x.r.warnings.length} предупр.</div>}</div>) },
    { key: 'moq', header: 'MOQ', align: 'right', sort: (x) => x.e.moq, csv: (x) => x.e.moq, cell: (x) => x.e.moq },
    { key: 'cap', header: 'Нужный капитал', align: 'right', sort: (x) => x.r.capital.toNumber(), csv: (x) => x.r.capital.toNumber(), cell: (x) => formatUzs(x.r.capital) },
    { key: 'unit', header: 'Себестоимость ед.', align: 'right', sort: (x) => x.r.unitCost.toNumber(), csv: (x) => x.r.unitCost.toNumber(), cell: (x) => formatUzs(x.r.unitCost) },
    { key: 'np', header: 'Чистая прибыль', align: 'right', sort: (x) => x.r.netProfit.toNumber(), csv: (x) => x.r.netProfit.toNumber(), cell: (x) => <Money value={x.r.netProfit} signed className="font-medium" /> },
    { key: 'mg', header: 'Маржа', align: 'right', sort: (x) => x.r.marginPct?.toNumber(), csv: (x) => x.r.marginPct?.toNumber() ?? null, cell: (x) => <Pct value={x.r.marginPct} /> },
    { key: 'roi', header: 'ROI', align: 'right', sort: (x) => x.r.roiPct?.toNumber(), csv: (x) => x.r.roiPct?.toNumber() ?? null, cell: (x) => <Pct value={x.r.roiPct} /> },
    { key: 'bep', header: 'Безубыточность, шт.', align: 'right', sort: (x) => x.r.breakEvenUnits, csv: (x) => x.r.breakEvenUnits, cell: (x) => (x.r.breakEvenUnits === null ? '—' : `${x.r.breakEvenUnits} из ${x.r.sellableQty}`) },
    { key: 'sell', header: 'Срок реализации', align: 'right', sort: (x) => x.r.monthsToSell?.toNumber(), csv: (x) => x.r.monthsToSell?.toNumber() ?? null, cell: (x) => (x.r.monthsToSell ? `${formatNumber(x.r.monthsToSell, 1)} мес.` : '—') },
    { key: 'pb', header: 'Окупаемость', align: 'right', sort: (x) => x.r.paybackMonths?.toNumber(), csv: (x) => x.r.paybackMonths?.toNumber() ?? null, cell: (x) => (x.r.paybackMonths ? `${formatNumber(x.r.paybackMonths, 1)} мес.` : '—') },
    {
      key: 'act',
      header: '',
      align: 'right',
      cell: (x) => (
        <div className="flex justify-end gap-0.5">
          <Button variant="ghost" size="icon" aria-label="Изменить" onClick={() => setEditing(x.e)}><Pencil /></Button>
          <Button variant="ghost" size="icon" aria-label="Удалить" onClick={async () => { if (await confirm({ title: `Удалить «${x.e.name}»?`, confirmLabel: 'Удалить', destructive: true })) await run(() => deleteEvaluation(x.e.id), 'Удалено') }}><Trash2 className="text-danger" /></Button>
        </div>
      ),
    },
  ]

  const allWarnings = rows.filter((x) => x.r.warnings.length > 0)

  return (
    <>
      <PageHeader
        title="Оценка закупки"
        description="Сравните потенциальные товары до покупки: прибыль, ROI, нужный капитал и срок окупаемости при заказе минимальной партии (MOQ). Сортируйте таблицу по любому показателю."
        actions={<Button onClick={() => setEditing('new')}><Plus /> Добавить товар</Button>}
      />
      {rows.length === 0 ? (
        <Card><EmptyState icon={ClipboardCheck} title="Нет товаров для сравнения" description="Добавьте кандидатов на закупку — цена поставщика, MOQ, доставка и ожидаемая цена на Uzum." action={<Button onClick={() => setEditing('new')}><Plus /> Добавить товар</Button>} /></Card>
      ) : (
        <>
          <DataTable rows={rows} columns={columns} rowKey={(x) => x.e.id} searchText={(x) => x.e.name} defaultSort={{ key: 'np', dir: 'desc' }} exportName="ocenka-zakupki" />
          {allWarnings.length > 0 && (
            <Card className="mt-4">
              <CardBody>
                <h2 className="mb-2 text-sm font-semibold">Предупреждения</h2>
                <ul className="space-y-2">
                  {allWarnings.map((x) => (
                    <li key={x.e.id}>
                      <div className="text-sm font-medium">{x.e.name}</div>
                      <ul className="mt-1 space-y-1">
                        {x.r.warnings.map((w, i) => <li key={i}><Notice tone={x.r.netProfit.isNegative() ? 'danger' : 'warning'} className="py-1 text-xs">{w}</Notice></li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Допущения: из-за брака и возвратов продаётся MOQ × (1 − риск); стоимость всей партии сохраняется; комиссия считается от цены продажи; ROI = чистая прибыль / (стоимость партии + расходы реализации). Это прогноз, а не гарантия.</p>
        </>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Новый товар для оценки' : 'Изменить оценку'} size="lg">
        {editing !== null && <EvaluationForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      </Dialog>
    </>
  )
}

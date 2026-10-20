import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, Boxes, Plus, Trash2, Warehouse } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { DataTable, type Column } from '@/components/data-table'
import { EmptyState, Notice, PageHeader, StatCard } from '@/components/common'
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter, useConfirm } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { addStockMovement, deleteMovement } from '@/data/actions'
import { useAppState, useDerived } from '@/data/store'
import { useAction } from '@/hooks/use-action'
import { recommendedReorder, type ProductStock } from '@/lib/calc/inventory'
import { COST_METHOD_LABEL, INBOUND_STATUSES, MOVEMENT_LABEL } from '@/lib/constants'
import { formatDate, formatNumber, formatUzs, todayIso } from '@/lib/format'
import type { InventoryMovement, Product } from '@/types/db'

const MANUAL_TYPES = ['opening', 'writeoff', 'defect', 'adjustment'] as const

const schema = z.object({
  product_id: z.string().min(1, 'Выберите товар'),
  type: z.enum(MANUAL_TYPES),
  qty: z.number({ error: 'Введите количество' }).int('Только целое число'),
  unit_cost_uzs: z.number().nullable(),
  movement_date: z.string().min(1, 'Укажите дату'),
  note: z.string(),
})
type Values = z.infer<typeof schema>

function MovementForm({ onClose }: { onClose: () => void }) {
  const { db } = useAppState()
  const { busy, run } = useAction()
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { product_id: '', type: 'writeoff', qty: 1, unit_cost_uzs: null, movement_date: todayIso(), note: '' },
  })
  const type = useWatch({ control, name: 'type' })
  const needsCost = type === 'opening' || type === 'adjustment'

  const onSubmit = handleSubmit(async (v) => {
    const ok = await run(
      () => addStockMovement({ ...v, unit_cost_uzs: needsCost ? v.unit_cost_uzs : null, note: v.note.trim() || null }),
      'Движение склада добавлено',
    )
    if (ok) onClose()
  })

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Товар" error={errors.product_id?.message} className="sm:col-span-2">
          <Select {...register('product_id')}>
            <option value="">— выберите —</option>
            {db.products.filter((p) => p.status === 'active').map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
            ))}
          </Select>
        </Field>
        <Field label="Операция">
          <Select {...register('type')}>
            <option value="opening">{MOVEMENT_LABEL.opening}</option>
            <option value="writeoff">{MOVEMENT_LABEL.writeoff}</option>
            <option value="defect">{MOVEMENT_LABEL.defect}</option>
            <option value="adjustment">{MOVEMENT_LABEL.adjustment}</option>
          </Select>
        </Field>
        <Field label="Дата" error={errors.movement_date?.message}>
          <Input type="date" {...register('movement_date')} />
        </Field>
        <Field label="Количество" error={errors.qty?.message} hint={type === 'adjustment' ? 'Со знаком: «−3» уменьшит остаток, «5» увеличит.' : 'Положительное число.'}>
          <Input type="number" step="1" {...register('qty', { valueAsNumber: true })} />
        </Field>
        {needsCost && (
          <Field label="Себестоимость единицы, UZS" error={errors.unit_cost_uzs?.message} hint="Нужна для оценки остатка.">
            <Input type="number" step="any" min="0" {...register('unit_cost_uzs', { setValueAs: (x) => (x === '' || x === null ? null : Number(x)) })} />
          </Field>
        )}
        <Field label="Комментарий" className="sm:col-span-2">
          <Textarea rows={2} {...register('note')} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Отмена</Button>
        <Button type="submit" disabled={busy}>Сохранить</Button>
      </DialogFooter>
    </form>
  )
}

interface Row {
  product: Product
  s: ProductStock
  inbound: number
  low: boolean
  perDay: number
  daysLeft: number | null
  reorder: number
}

export default function Inventory() {
  const { db } = useAppState()
  const d = useDerived()
  const confirm = useConfirm()
  const { run } = useAction()
  const [adding, setAdding] = useState(false)
  const [lead, setLead] = useState(30)
  const [cover, setCover] = useState(30)
  const [windowDays, setWindowDays] = useState(30)
  const today = todayIso()

  const rows = useMemo<Row[]>(() => {
    const from = new Date(`${today}T00:00:00`)
    from.setDate(from.getDate() - windowDays + 1)
    const fromIso = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`
    const soldRecent = new Map<string, number>()
    for (const l of d.finance.lines) if (l.date >= fromIso) soldRecent.set(l.productId, (soldRecent.get(l.productId) ?? 0) + l.qty)
    for (const r of d.finance.returns) if (r.date >= fromIso && r.restock) soldRecent.set(r.productId, (soldRecent.get(r.productId) ?? 0) - r.qty)
    const inboundBatches = new Set(db.purchase_batches.filter((b) => INBOUND_STATUSES.includes(b.status)).map((b) => b.id))
    const inbound = new Map<string, number>()
    for (const it of db.purchase_batch_items) if (inboundBatches.has(it.batch_id)) inbound.set(it.product_id, (inbound.get(it.product_id) ?? 0) + it.qty_ordered)

    return db.products
      .filter((p) => p.status === 'active' || (d.inventory.byProduct.get(p.id)?.stock ?? 0) !== 0)
      .map((product) => {
        const s = d.inventory.byProduct.get(product.id)!
        const inb = inbound.get(product.id) ?? 0
        const rec = recommendedReorder({ soldLastDays: Math.max(soldRecent.get(product.id) ?? 0, 0), windowDays, available: s?.available ?? 0, inbound: inb, leadTimeDays: lead, coverDays: cover })
        return { product, s, inbound: inb, low: product.min_stock > 0 && s.available <= product.min_stock, perDay: rec.perDay, daysLeft: rec.daysLeft, reorder: rec.qty }
      })
      .filter((r) => r.s)
  }, [db, d, windowDays, lead, cover, today])

  const lowRows = rows.filter((r) => r.low)
  const totalValue = d.inventory.totalValue
  const totalQty = d.inventory.totalQty

  const columns: Column<Row>[] = [
    { key: 'name', header: 'Товар', sort: (r) => r.product.name, csv: (r) => r.product.name, cell: (r) => (<div><div className="font-medium">{r.product.name}</div><div className="text-xs text-muted-foreground">{r.product.sku}</div></div>) },
    { key: 'open', header: 'Начальный', align: 'right', sort: (r) => r.s.opening, csv: (r) => r.s.opening, cell: (r) => r.s.opening },
    { key: 'recv', header: 'Поступило', align: 'right', sort: (r) => r.s.received, csv: (r) => r.s.received, cell: (r) => r.s.received },
    { key: 'sold', header: 'Продано', align: 'right', sort: (r) => r.s.sold, csv: (r) => r.s.sold, cell: (r) => r.s.sold },
    { key: 'ret', header: 'Возвраты', align: 'right', sort: (r) => r.s.returned, csv: (r) => r.s.returned, cell: (r) => r.s.returned },
    { key: 'wo', header: 'Списано', align: 'right', sort: (r) => r.s.writtenOff, csv: (r) => r.s.writtenOff, cell: (r) => r.s.writtenOff },
    { key: 'stock', header: 'Остаток', align: 'right', sort: (r) => r.s.stock, csv: (r) => r.s.stock, cell: (r) => (<span className="inline-flex items-center gap-1.5 font-semibold">{r.low && <AlertTriangle className="size-3.5 text-warning" aria-label="Низкий остаток" />}{r.s.stock}</span>) },
    { key: 'res', header: 'Резерв', align: 'right', sort: (r) => r.s.reserved, csv: (r) => r.s.reserved, cell: (r) => r.s.reserved },
    { key: 'avail', header: 'Доступно', align: 'right', sort: (r) => r.s.available, csv: (r) => r.s.available, cell: (r) => r.s.available },
    { key: 'avg', header: 'Ср. себестоимость', align: 'right', sort: (r) => r.s.avgCost?.toNumber(), csv: (r) => r.s.avgCost?.toNumber() ?? null, cell: (r) => (r.s.avgCost ? formatUzs(r.s.avgCost) : '—') },
    { key: 'val', header: 'Стоимость остатка', align: 'right', sort: (r) => r.s.value.toNumber(), csv: (r) => r.s.value.toNumber(), cell: (r) => formatUzs(r.s.value) },
    { key: 'min', header: 'Мин.', align: 'right', sort: (r) => r.product.min_stock, csv: (r) => r.product.min_stock, cell: (r) => r.product.min_stock },
  ]

  const reorderCols: Column<Row>[] = [
    { key: 'name', header: 'Товар', sort: (r) => r.product.name, csv: (r) => r.product.name, cell: (r) => r.product.name },
    { key: 'perDay', header: 'Продаж в день', align: 'right', sort: (r) => r.perDay, csv: (r) => Number(r.perDay.toFixed(2)), cell: (r) => formatNumber(r.perDay, 2) },
    { key: 'avail', header: 'Доступно', align: 'right', sort: (r) => r.s.available, csv: (r) => r.s.available, cell: (r) => r.s.available },
    { key: 'inb', header: 'В пути', align: 'right', sort: (r) => r.inbound, csv: (r) => r.inbound, cell: (r) => r.inbound },
    { key: 'days', header: 'Хватит на', align: 'right', sort: (r) => r.daysLeft, csv: (r) => r.daysLeft, cell: (r) => (r.daysLeft === null ? '—' : <span className={r.daysLeft < lead ? 'font-medium text-warning' : ''}>{r.daysLeft} дн.</span>) },
    { key: 'rec', header: 'Рекомендуем заказать', align: 'right', sort: (r) => r.reorder, csv: (r) => r.reorder, cell: (r) => (r.reorder > 0 ? <Badge tone="primary">{r.reorder} шт.</Badge> : <span className="text-muted-foreground">не нужно</span>) },
  ]

  const movements = useMemo(
    () => [...db.inventory_movements].sort((a, b) => b.movement_date.localeCompare(a.movement_date) || b.created_at.localeCompare(a.created_at)),
    [db.inventory_movements],
  )
  const moveCols: Column<InventoryMovement>[] = [
    { key: 'date', header: 'Дата', sort: (m) => m.movement_date, csv: (m) => m.movement_date, cell: (m) => formatDate(m.movement_date) },
    { key: 'prod', header: 'Товар', csv: (m) => d.productsById.get(m.product_id)?.name ?? '', cell: (m) => d.productsById.get(m.product_id)?.name ?? '—' },
    { key: 'type', header: 'Операция', sort: (m) => m.type, csv: (m) => MOVEMENT_LABEL[m.type], cell: (m) => <Badge tone={m.qty > 0 ? 'success' : 'neutral'}>{MOVEMENT_LABEL[m.type]}</Badge> },
    { key: 'qty', header: 'Кол-во', align: 'right', sort: (m) => m.qty, csv: (m) => m.qty, cell: (m) => <span className={m.qty > 0 ? 'text-success' : 'text-danger'}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span> },
    { key: 'cost', header: 'Себестоимость ед.', align: 'right', csv: (m) => d.inventory.movementCosts.get(m.id)?.unitCost?.toNumber() ?? null, cell: (m) => { const c = d.inventory.movementCosts.get(m.id)?.unitCost; return c ? formatUzs(c) : '—' } },
    { key: 'note', header: 'Комментарий', csv: (m) => m.note ?? '', cell: (m) => <span className="block max-w-56 truncate text-muted-foreground" title={m.note ?? ''}>{m.note ?? ''}</span> },
    {
      key: 'act',
      header: '',
      align: 'right',
      cell: (m) =>
        m.type === 'receipt' || m.type === 'sale' || m.type === 'return' ? (
          <span className="text-xs text-muted-foreground">авто</span>
        ) : (
          <Button variant="ghost" size="icon" aria-label="Удалить" onClick={async () => { if (await confirm({ title: 'Удалить движение?', description: 'Остаток товара будет пересчитан.', confirmLabel: 'Удалить', destructive: true })) await run(() => deleteMovement(m.id), 'Движение удалено') }}>
            <Trash2 className="text-danger" />
          </Button>
        ),
    },
  ]

  if (db.products.length === 0)
    return (
      <>
        <PageHeader title="Склад и остатки" />
        <Card><EmptyState icon={Warehouse} title="Нет товаров" description="Сначала добавьте товары в разделе «Товары»." /></Card>
      </>
    )

  const warnings = d.inventory.warnings

  return (
    <>
      <PageHeader
        title="Склад и остатки"
        description={`Остатки меняются автоматически: приход по полученным партиям, продажи, возвраты, брак и списания. Метод себестоимости: ${COST_METHOD_LABEL[db.profile?.cost_method ?? 'wac']} (меняется в настройках).`}
        actions={<Button onClick={() => setAdding(true)}><Plus /> Движение склада</Button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Стоимость остатков" value={formatUzs(totalValue)} icon={Boxes} />
        <StatCard label="Единиц на складе" value={formatNumber(totalQty)} />
        <StatCard label="Позиций с остатком" value={formatNumber(rows.filter((r) => r.s.stock > 0).length)} sub={`из ${rows.length}`} />
        <StatCard label="Низкий остаток" value={formatNumber(lowRows.length)} icon={AlertTriangle} tone={lowRows.length ? 'warning' : 'neutral'} />
      </div>
      {lowRows.length > 0 && (
        <Notice tone="warning" className="mb-4">
          Заканчиваются: {lowRows.map((r) => `${r.product.name} (${r.s.available} шт.)`).join(', ')}.
        </Notice>
      )}
      {warnings.length > 0 && (
        <Notice tone="danger" className="mb-4">
          <p className="font-medium">Проверьте данные склада:</p>
          <ul className="mt-1 list-disc pl-4 text-xs">{warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Notice>
      )}

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Остатки</TabsTrigger>
          <TabsTrigger value="reorder">Что докупить</TabsTrigger>
          <TabsTrigger value="moves">Движения</TabsTrigger>
        </TabsList>
        <TabsContent value="stock" className="mt-3">
          <DataTable rows={rows} columns={columns} rowKey={(r) => r.product.id} searchText={(r) => `${r.product.name} ${r.product.sku}`} searchPlaceholder="Поиск по названию или артикулу" defaultSort={{ key: 'stock', dir: 'asc' }} exportName="ostatki" />
        </TabsContent>
        <TabsContent value="reorder" className="mt-3">
          <Card className="mb-3">
            <CardHeader title="Параметры расчёта" description="Потребность = продажи в день × (срок поставки + желаемый запас) − остаток − заказанное в пути" />
            <CardBody className="grid gap-3 sm:grid-cols-3">
              <Field label="Срок поставки, дней"><Input type="number" min={0} value={lead} onChange={(e) => setLead(Math.max(0, Number(e.target.value) || 0))} /></Field>
              <Field label="Желаемый запас, дней"><Input type="number" min={0} value={cover} onChange={(e) => setCover(Math.max(0, Number(e.target.value) || 0))} /></Field>
              <Field label="Скорость продаж за последние, дней"><Input type="number" min={1} value={windowDays} onChange={(e) => setWindowDays(Math.max(1, Number(e.target.value) || 1))} /></Field>
            </CardBody>
          </Card>
          <DataTable rows={rows.filter((r) => r.product.status === 'active')} columns={reorderCols} rowKey={(r) => r.product.id} searchText={(r) => r.product.name} defaultSort={{ key: 'rec', dir: 'desc' }} exportName="zakupka-rekomendacii" />
          <p className="mt-2 text-xs text-muted-foreground">Это ориентир на основе недавних продаж. Учитывайте сезонность и бюджет.</p>
        </TabsContent>
        <TabsContent value="moves" className="mt-3">
          <DataTable rows={movements} columns={moveCols} rowKey={(m) => m.id} searchText={(m) => `${d.productsById.get(m.product_id)?.name ?? ''} ${MOVEMENT_LABEL[m.type]} ${m.note ?? ''}`} defaultSort={{ key: 'date', dir: 'desc' }} exportName="dvizheniya-sklada" empty="Движений пока нет." />
        </TabsContent>
      </Tabs>

      <Dialog open={adding} onOpenChange={setAdding} title="Движение склада" description="Начальный остаток, списание, брак или корректировка. Приходы, продажи и возвраты создаются автоматически.">
        {adding && <MovementForm onClose={() => setAdding(false)} />}
      </Dialog>
    </>
  )
}


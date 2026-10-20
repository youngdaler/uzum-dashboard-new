import { CornerUpLeft, Pencil, Plus, ShoppingCart, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DataTable, type Column } from '@/components/data-table'
import { DateRangeFilter, EmptyState, Money, PageHeader, StatCard } from '@/components/common'
import { ReturnForm } from '@/components/forms/return-form'
import { SaleForm } from '@/components/forms/sale-form'
import { Badge } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, useConfirm } from '@/components/ui/dialog'
import { Select } from '@/components/ui/form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { deleteReturn, deleteSale, markPayoutReceived } from '@/data/actions'
import { useAppState, useDerived } from '@/data/store'
import { useAction } from '@/hooks/use-action'
import { SALE_STATUS_LABEL } from '@/lib/constants'
import { formatDate, formatNumber, formatUzs, todayIso } from '@/lib/format'
import { D, Decimal, sum } from '@/lib/money'
import type { ReturnRow, Sale, SaleStatus } from '@/types/db'

interface Row {
  sale: Sale
  products: string
  units: number
  revenue: Decimal
  deductions: Decimal
  expectedPayout: Decimal
  payout: Decimal
  cogs: Decimal
  profit: Decimal | null
  completed: boolean
}

const STATUS_TONE: Record<SaleStatus, 'success' | 'primary' | 'neutral'> = { completed: 'success', in_progress: 'primary', cancelled: 'neutral' }

export default function SalesPage() {
  const { db } = useAppState()
  const d = useDerived()
  const confirm = useConfirm()
  const { run } = useAction()
  const [editing, setEditing] = useState<Sale | 'new' | null>(null)
  const [returning, setReturning] = useState<ReturnRow | 'new' | { itemId: string } | null>(null)
  const [status, setStatus] = useState<'' | SaleStatus>('')
  const [range, setRange] = useState({ from: '', to: '' })

  const rows = useMemo<Row[]>(() => {
    const fin = d.finance
    return db.sales.map((s) => {
      const items = db.sale_items.filter((i) => i.sale_id === s.id)
      const lines = fin.lines.filter((l) => l.saleId === s.id)
      const itemIds = new Set(items.map((i) => i.id))
      const rets = fin.returns.filter((r) => itemIds.has(r.saleItemId))
      const gross = sum(items.map((i) => D(i.unit_price_uzs).mul(i.qty).minus(i.seller_discount_uzs)))
      const deductions = sum(items.map((i) => D(i.commission_uzs).plus(i.logistics_uzs).plus(i.other_deductions_uzs)))
      const completed = s.status === 'completed'
      const cogs = sum(lines.map((l) => l.cogs))
      const profit = completed
        ? sum(lines.map((l) => l.revenue.minus(l.cogs).minus(l.commission).minus(l.logistics).minus(l.otherDeductions).minus(l.ads).minus(l.packaging).minus(l.extra))).plus(
            sum(rets.map((r) => r.refund.negated().plus(r.costReversal).plus(r.commissionRefund).minus(r.returnLogistics).plus(r.compensation))),
          )
        : null
      const expected = gross.minus(deductions)
      return {
        sale: s,
        products: items.map((i) => d.productsById.get(i.product_id)?.name ?? '').join(', '),
        units: items.reduce((a, i) => a + i.qty, 0),
        revenue: gross,
        deductions,
        expectedPayout: expected,
        payout: s.payout_actual_uzs !== null ? D(s.payout_actual_uzs) : expected,
        cogs,
        profit,
        completed,
      }
    })
  }, [db, d])

  const filtered = rows.filter(
    (r) => (!status || r.sale.status === status) && (!range.from || r.sale.sale_date >= range.from) && (!range.to || r.sale.sale_date <= range.to),
  )
  const done = filtered.filter((r) => r.completed)
  const stats = {
    orders: done.length,
    revenue: sum(done.map((r) => r.revenue)),
    profit: sum(done.map((r) => r.profit ?? 0)),
    awaiting: sum(done.filter((r) => !r.sale.payout_received_date).map((r) => r.payout)),
    cancelled: filtered.filter((r) => r.sale.status === 'cancelled').length,
  }

  const onDelete = async (s: Sale) => {
    if (await confirm({ title: `Удалить заказ ${s.order_no}?`, description: 'Вместе с заказом удалятся его позиции, возвраты и движения склада. Остатки пересчитаются.', confirmLabel: 'Удалить', destructive: true }))
      await run(() => deleteSale(s.id), 'Заказ удалён')
  }

  const columns: Column<Row>[] = [
    { key: 'date', header: 'Дата', sort: (r) => r.sale.sale_date, csv: (r) => r.sale.sale_date, cell: (r) => formatDate(r.sale.sale_date) },
    { key: 'no', header: 'Заказ', sort: (r) => r.sale.order_no, csv: (r) => r.sale.order_no, cell: (r) => <span className="font-medium">{r.sale.order_no}</span> },
    { key: 'prod', header: 'Товары', csv: (r) => r.products, cell: (r) => <span className="block max-w-56 truncate text-muted-foreground" title={r.products}>{r.products}</span> },
    { key: 'units', header: 'Шт.', align: 'right', sort: (r) => r.units, csv: (r) => r.units, cell: (r) => r.units },
    { key: 'st', header: 'Статус', sort: (r) => r.sale.status, csv: (r) => SALE_STATUS_LABEL[r.sale.status], cell: (r) => <Badge tone={STATUS_TONE[r.sale.status]}>{SALE_STATUS_LABEL[r.sale.status]}</Badge> },
    { key: 'rev', header: 'Выручка', align: 'right', sort: (r) => r.revenue.toNumber(), csv: (r) => r.revenue.toNumber(), cell: (r) => <span className={r.sale.status === 'cancelled' ? 'text-muted-foreground line-through' : ''}>{formatUzs(r.revenue)}</span> },
    { key: 'ded', header: 'Удержания Uzum', align: 'right', sort: (r) => r.deductions.toNumber(), csv: (r) => r.deductions.toNumber(), cell: (r) => <span className="text-muted-foreground">{formatUzs(r.deductions)}</span> },
    {
      key: 'pay',
      header: 'Выплата',
      align: 'right',
      sort: (r) => r.payout.toNumber(),
      csv: (r) => (r.completed ? r.payout.toNumber() : null),
      cell: (r) =>
        r.completed ? (
          <div>
            <Money value={r.payout} />
            <div className="text-xs">
              {r.sale.payout_received_date ? <span className="text-success">получена {formatDate(r.sale.payout_received_date)}</span> : <span className="text-warning">ожидается</span>}
            </div>
          </div>
        ) : (
          '—'
        ),
    },
    { key: 'cogs', header: 'Себестоимость', align: 'right', sort: (r) => r.cogs.toNumber(), csv: (r) => (r.completed ? r.cogs.toNumber() : null), cell: (r) => (r.completed ? formatUzs(r.cogs) : '—') },
    { key: 'profit', header: 'Прибыль', align: 'right', sort: (r) => r.profit?.toNumber(), csv: (r) => r.profit?.toNumber() ?? null, cell: (r) => (r.profit ? <Money value={r.profit} signed /> : '—') },
    {
      key: 'act',
      header: '',
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          {r.completed && !r.sale.payout_received_date && (
            <Button size="sm" variant="outline" onClick={() => void run(() => markPayoutReceived(r.sale.id, todayIso(), r.sale.payout_actual_uzs), 'Выплата отмечена как полученная')}>
              Выплата получена
            </Button>
          )}
          {r.completed && (
            <Button variant="ghost" size="icon" aria-label="Оформить возврат" title="Оформить возврат" onClick={() => setReturning({ itemId: db.sale_items.find((i) => i.sale_id === r.sale.id)?.id ?? '' })}>
              <CornerUpLeft />
            </Button>
          )}
          <Button variant="ghost" size="icon" aria-label="Изменить" onClick={() => setEditing(r.sale)}><Pencil /></Button>
          <Button variant="ghost" size="icon" aria-label="Удалить" onClick={() => void onDelete(r.sale)}><Trash2 className="text-danger" /></Button>
        </div>
      ),
    },
  ]

  const returnRows = db.returns
    .map((r) => {
      const item = db.sale_items.find((i) => i.id === r.sale_item_id)
      const sale = db.sales.find((s) => s.id === item?.sale_id)
      return { r, order: sale?.order_no ?? '—', product: db.products.find((p) => p.id === item?.product_id)?.name ?? '—' }
    })
    .filter((x) => (!range.from || x.r.return_date >= range.from) && (!range.to || x.r.return_date <= range.to))

  const returnCols: Column<(typeof returnRows)[number]>[] = [
    { key: 'date', header: 'Дата', sort: (x) => x.r.return_date, csv: (x) => x.r.return_date, cell: (x) => formatDate(x.r.return_date) },
    { key: 'order', header: 'Заказ', sort: (x) => x.order, csv: (x) => x.order, cell: (x) => x.order },
    { key: 'prod', header: 'Товар', csv: (x) => x.product, cell: (x) => x.product },
    { key: 'kind', header: 'Тип', csv: (x) => (x.r.kind === 'return' ? 'Возврат' : 'Повреждён'), cell: (x) => <Badge tone={x.r.kind === 'return' ? 'warning' : 'danger'}>{x.r.kind === 'return' ? 'Возврат' : 'Повреждён'}</Badge> },
    { key: 'qty', header: 'Шт.', align: 'right', sort: (x) => x.r.qty, csv: (x) => x.r.qty, cell: (x) => x.r.qty },
    { key: 'stock', header: 'На склад', csv: (x) => (x.r.restock ? 'Да' : 'Нет'), cell: (x) => (x.r.restock ? 'Да' : 'Нет') },
    { key: 'refund', header: 'Возврат денег', align: 'right', sort: (x) => x.r.refund_uzs, csv: (x) => x.r.refund_uzs, cell: (x) => formatUzs(x.r.refund_uzs) },
    { key: 'comm', header: 'Возврат комиссии', align: 'right', csv: (x) => x.r.commission_refund_uzs, cell: (x) => formatUzs(x.r.commission_refund_uzs) },
    { key: 'log', header: 'Логистика возврата', align: 'right', csv: (x) => x.r.return_logistics_uzs, cell: (x) => formatUzs(x.r.return_logistics_uzs) },
    { key: 'comp', header: 'Компенсация', align: 'right', csv: (x) => x.r.compensation_uzs, cell: (x) => formatUzs(x.r.compensation_uzs) },
    {
      key: 'act',
      header: '',
      align: 'right',
      cell: (x) => (
        <div className="flex justify-end gap-0.5">
          <Button variant="ghost" size="icon" aria-label="Изменить" onClick={() => setReturning(x.r)}><Pencil /></Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Удалить"
            onClick={async () => {
              if (await confirm({ title: 'Удалить возврат?', description: 'Если товар возвращался на склад, остаток уменьшится.', confirmLabel: 'Удалить', destructive: true })) await run(() => deleteReturn(x.r.id), 'Возврат удалён')
            }}
          >
            <Trash2 className="text-danger" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Продажи"
        description="Заказы Uzum с комиссиями и удержаниями. В выручку и прибыль входят только завершённые заказы; отменённые и «в работе» — нет."
        actions={
          <>
            <Button variant="outline" onClick={() => setReturning('new')} disabled={db.sale_items.length === 0}><CornerUpLeft /> Оформить возврат</Button>
            <Button onClick={() => setEditing('new')} disabled={db.products.length === 0}><Plus /> Новая продажа</Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Завершённых заказов" value={formatNumber(stats.orders)} icon={ShoppingCart} />
        <StatCard label="Выручка" value={formatUzs(stats.revenue)} sub="до возвратов" />
        <StatCard label="Прибыль по заказам" value={formatUzs(stats.profit)} tone={stats.profit.isNegative() ? 'danger' : 'success'} sub="до общих расходов" />
        <StatCard label="Выплаты в ожидании" value={formatUzs(stats.awaiting)} tone={stats.awaiting.gt(0) ? 'warning' : 'neutral'} hint="Завершённые заказы, выплата по которым ещё не получена" />
        <StatCard label="Отменено" value={stats.cancelled} sub="не считаются продажами" />
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Заказы ({filtered.length})</TabsTrigger>
          <TabsTrigger value="returns">Возвраты и повреждения ({returnRows.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="orders">
          <DataTable
            rows={filtered}
            columns={columns}
            rowKey={(r) => r.sale.id}
            searchText={(r) => `${r.sale.order_no} ${r.products}`}
            searchPlaceholder="Номер заказа, товар…"
            defaultSort={{ key: 'date', dir: 'desc' }}
            exportName="продажи"
            toolbar={
              <>
                <Select aria-label="Статус" value={status} onChange={(e) => setStatus(e.target.value as '' | SaleStatus)} className="w-40">
                  <option value="">Все статусы</option>
                  {Object.entries(SALE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
                <DateRangeFilter {...range} onChange={setRange} />
              </>
            }
            empty={<EmptyState icon={ShoppingCart} title="Продаж пока нет" description={db.products.length === 0 ? 'Сначала добавьте товары и партию закупки.' : 'Зарегистрируйте первый заказ Uzum.'} action={db.products.length > 0 ? <Button onClick={() => setEditing('new')}><Plus /> Новая продажа</Button> : undefined} />}
          />
        </TabsContent>
        <TabsContent value="returns">
          <DataTable rows={returnRows} columns={returnCols} rowKey={(x) => x.r.id} defaultSort={{ key: 'date', dir: 'desc' }} exportName="возвраты" empty="Возвратов нет." toolbar={<DateRangeFilter {...range} onChange={setRange} />} />
        </TabsContent>
      </Tabs>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Новая продажа' : 'Редактирование заказа'} size="xl">
        {editing !== null && <SaleForm key={editing === 'new' ? 'n' : editing.id} sale={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      </Dialog>
      <Dialog open={returning !== null} onOpenChange={(o) => !o && setReturning(null)} title={returning !== null && returning !== 'new' && 'id' in returning ? 'Редактирование возврата' : 'Возврат или повреждение'} size="md">
        {returning !== null && (
          <ReturnForm
            key={returning === 'new' ? 'n' : 'itemId' in returning ? returning.itemId : returning.id}
            ret={returning !== 'new' && 'id' in returning ? returning : null}
            presetSaleItemId={returning !== 'new' && 'itemId' in returning ? returning.itemId || undefined : undefined}
            onClose={() => setReturning(null)}
          />
        )}
      </Dialog>
    </>
  )
}

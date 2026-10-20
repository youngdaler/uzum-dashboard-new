import { Plus, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataTable, type Column } from '@/components/data-table'
import { EmptyState, Money, PageHeader, Pct, StatCard } from '@/components/common'
import { BatchForm } from '@/components/forms/batch-form'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Select } from '@/components/ui/form'
import { setBatchStatus } from '@/data/actions'
import { useAppState, useDerived } from '@/data/store'
import { useAction } from '@/hooks/use-action'
import { batchReport } from '@/lib/calc/finance'
import { BATCH_STATUSES, BATCH_STATUS_LABEL } from '@/lib/constants'
import { formatDate, formatNumber, formatUzs } from '@/lib/format'
import { sum } from '@/lib/money'
import type { BatchStatus, PurchaseBatch } from '@/types/db'

export const STATUS_TONE: Record<BatchStatus, 'neutral' | 'primary' | 'warning' | 'success'> = {
  ordered: 'neutral',
  paid: 'neutral',
  shipped: 'primary',
  in_transit: 'primary',
  customs: 'warning',
  received: 'success',
  selling: 'success',
  closed: 'neutral',
}

interface Row {
  batch: PurchaseBatch
  supplier: string
  products: string
  qty: number
  invested: number
  unitCost: number | null
  debtUzs: number
  plannedProfit: number
  roi: number | null
  realized: number
  soldQty: number
}

export default function BatchesPage() {
  const { db } = useAppState()
  const d = useDerived()
  const nav = useNavigate()
  const { run } = useAction()
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState<'' | BatchStatus>('')

  const rows = useMemo<Row[]>(() => {
    const rep = new Map(batchReport(d.finance).map((r) => [r.batchId, r]))
    const sup = new Map(db.suppliers.map((s) => [s.id, s.name]))
    return db.purchase_batches.map((b) => {
      const c = d.batchCalcs.get(b.id)!
      const r = rep.get(b.id)
      return {
        batch: b,
        supplier: b.supplier_id ? (sup.get(b.supplier_id) ?? '—') : '—',
        products: c.items.map((i) => d.productsById.get(i.product_id)?.name ?? '').filter(Boolean).join(', '),
        qty: c.qtyAvailable,
        invested: c.totalCostUzs.toNumber(),
        unitCost: c.unitCostAvgUzs?.toNumber() ?? null,
        debtUzs: c.debtUzs.toNumber(),
        plannedProfit: c.plannedNetProfit.toNumber(),
        roi: c.roiPct?.toNumber() ?? null,
        realized: r?.realizedProfit.toNumber() ?? 0,
        soldQty: r?.soldQty ?? 0,
      }
    })
  }, [db, d])

  const filtered = status ? rows.filter((r) => r.batch.status === status) : rows
  const active = rows.filter((r) => r.batch.status !== 'closed')
  const totals = {
    invested: sum(active.map((r) => r.invested)),
    debt: sum(rows.map((r) => r.debtUzs)),
    planned: sum(active.map((r) => r.plannedProfit)),
  }

  const columns: Column<Row>[] = [
    { key: 'no', header: 'Номер', sort: (r) => r.batch.batch_no, csv: (r) => r.batch.batch_no, cell: (r) => <span className="font-medium">{r.batch.batch_no}</span> },
    { key: 'date', header: 'Дата заказа', sort: (r) => r.batch.order_date, csv: (r) => r.batch.order_date, cell: (r) => formatDate(r.batch.order_date) },
    { key: 'sup', header: 'Поставщик', sort: (r) => r.supplier, csv: (r) => r.supplier, cell: (r) => r.supplier },
    { key: 'prod', header: 'Товары', csv: (r) => r.products, cell: (r) => <span className="block max-w-56 truncate text-muted-foreground" title={r.products}>{r.products || '—'}</span> },
    {
      key: 'status',
      header: 'Статус',
      sort: (r) => BATCH_STATUSES.indexOf(r.batch.status),
      csv: (r) => BATCH_STATUS_LABEL[r.batch.status],
      cell: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Select
            aria-label={`Статус партии ${r.batch.batch_no}`}
            value={r.batch.status}
            onChange={(e) => void run(() => setBatchStatus(r.batch.id, e.target.value as BatchStatus), 'Статус обновлён')}
            className="h-8 w-36 text-[13px]"
          >
            {BATCH_STATUSES.map((s) => (
              <option key={s} value={s}>{BATCH_STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </span>
      ),
    },
    { key: 'qty', header: 'Годных, шт.', align: 'right', sort: (r) => r.qty, csv: (r) => r.qty, cell: (r) => formatNumber(r.qty) },
    { key: 'sold', header: 'Продано', align: 'right', sort: (r) => r.soldQty, csv: (r) => r.soldQty, cell: (r) => formatNumber(r.soldQty) },
    { key: 'inv', header: 'Вложено', align: 'right', sort: (r) => r.invested, csv: (r) => Math.round(r.invested), cell: (r) => formatUzs(r.invested) },
    { key: 'unit', header: 'Себестоим. ед.', align: 'right', sort: (r) => r.unitCost, csv: (r) => (r.unitCost === null ? null : Math.round(r.unitCost)), cell: (r) => (r.unitCost === null ? '—' : formatUzs(r.unitCost)) },
    { key: 'debt', header: 'Долг поставщику', align: 'right', sort: (r) => r.debtUzs, csv: (r) => Math.round(r.debtUzs), cell: (r) => (r.debtUzs > 0 ? <span className="text-warning">{formatUzs(r.debtUzs)}</span> : <span className="text-muted-foreground">—</span>) },
    { key: 'plan', header: 'План. прибыль', align: 'right', sort: (r) => r.plannedProfit, csv: (r) => Math.round(r.plannedProfit), cell: (r) => <Money value={r.plannedProfit} signed /> },
    { key: 'roi', header: 'ROI (план)', align: 'right', sort: (r) => r.roi, csv: (r) => (r.roi === null ? null : Math.round(r.roi * 10) / 10), cell: (r) => <Pct value={r.roi} /> },
  ]

  return (
    <>
      <PageHeader
        title="Партии закупок"
        description="Каждая партия — отдельная финансовая карточка: закупка, карго и прочие расходы, себестоимость, оплата поставщику и плановая прибыль."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Новая партия
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Активных партий" value={active.length} sub={`всего ${rows.length}`} icon={Truck} />
        <StatCard label="Вложено в активные партии" value={formatUzs(totals.invested)} />
        <StatCard label="Долг поставщикам" value={formatUzs(totals.debt)} tone={totals.debt.gt(0) ? 'warning' : 'neutral'} />
        <StatCard label="Плановая прибыль (активные)" value={formatUzs(totals.planned)} tone={totals.planned.isNegative() ? 'danger' : totals.planned.gt(0) ? 'success' : 'neutral'} hint="План по текущим ценам и тарифам; факт — на странице «Финансы»" />
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.batch.id}
        searchText={(r) => `${r.batch.batch_no} ${r.supplier} ${r.products}`}
        searchPlaceholder="Номер, поставщик, товар…"
        defaultSort={{ key: 'date', dir: 'desc' }}
        onRowClick={(r) => nav(`/batches/${r.batch.id}`)}
        exportName="партии"
        toolbar={
          <Select aria-label="Статус" value={status} onChange={(e) => setStatus(e.target.value as '' | BatchStatus)} className="w-44">
            <option value="">Все статусы</option>
            {BATCH_STATUSES.map((s) => (
              <option key={s} value={s}>{BATCH_STATUS_LABEL[s]}</option>
            ))}
          </Select>
        }
        empty={
          <EmptyState
            icon={Truck}
            title="Партий пока нет"
            description="Создайте партию закупки: выберите товары, укажите курс и добавьте расходы на доставку — себестоимость посчитается автоматически."
            action={<Button onClick={() => setCreating(true)}><Plus /> Новая партия</Button>}
          />
        }
      />
      <p className="mt-2 text-xs text-muted-foreground">Нажмите на строку, чтобы открыть карточку партии.</p>

      <Dialog open={creating} onOpenChange={setCreating} title="Новая партия закупки" size="xl">
        {creating && <BatchForm batch={null} onClose={() => setCreating(false)} onSaved={(b) => nav(`/batches/${b.id}`)} />}
      </Dialog>
    </>
  )
}

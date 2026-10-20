import { CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DataTable, type Column } from '@/components/data-table'
import { KeyValue, Money, Notice, PageHeader, Pct, StatCard } from '@/components/common'
import { PaymentForm, PAYMENT_KIND_LABEL } from '@/components/forms/payment-form'
import { PeriodPicker, usePeriod } from '@/components/period-picker'
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, useConfirm } from '@/components/ui/dialog'
import { Segmented, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { deletePayment, markPaymentPaid } from '@/data/actions'
import { useAppState, useDerived } from '@/data/store'
import { useAction } from '@/hooks/use-action'
import {
  batchReport,
  buildSeries,
  periodMetrics,
  productReport,
  snapshot,
  type BatchReportRow,
  type Granularity,
  type ProductReportRow,
  type SeriesPoint,
} from '@/lib/calc/finance'
import { BATCH_STATUS_LABEL } from '@/lib/constants'
import { formatDate, formatMoney, formatNumber, formatUzs } from '@/lib/format'
import type { Payment } from '@/types/db'

export default function Finance() {
  const { db } = useAppState()
  const d = useDerived()
  const range = usePeriod()
  const confirm = useConfirm()
  const { run } = useAction()
  const [editing, setEditing] = useState<Payment | 'new' | null>(null)
  const [gran, setGran] = useState<Granularity>('month')

  const fin = d.finance
  const m = useMemo(() => periodMetrics(fin, range), [fin, range])
  const snap = useMemo(() => snapshot(fin), [fin])
  const prodRep = useMemo(() => productReport(fin, range), [fin, range])
  const batchRep = useMemo(() => batchReport(fin), [fin])
  const series = useMemo(() => buildSeries(fin, range, gran), [fin, range, gran])
  const taxLabel = fin.profile.tax_mode === 'actual' ? 'Налоги (фактические расходы)' : `Налог (расчётный, ${fin.profile.tax_rate_pct}% от ${fin.profile.tax_base === 'revenue' ? 'выручки' : 'прибыли'})`

  const productName = (id: string) => d.productsById.get(id)?.name ?? '—'
  const batchNo = (id: string) => db.purchase_batches.find((b) => b.id === id)?.batch_no ?? '—'

  const productCols: Column<ProductReportRow>[] = [
    { key: 'name', header: 'Товар', sort: (r) => productName(r.productId), csv: (r) => productName(r.productId), cell: (r) => <span className="font-medium">{productName(r.productId)}</span> },
    { key: 'units', header: 'Продано, шт.', align: 'right', sort: (r) => r.units, csv: (r) => r.units, cell: (r) => formatNumber(r.units) },
    { key: 'rev', header: 'Выручка', align: 'right', sort: (r) => r.revenue.toNumber(), csv: (r) => r.revenue.toNumber(), cell: (r) => formatUzs(r.revenue) },
    { key: 'cogs', header: 'Себестоимость', align: 'right', sort: (r) => r.cogs.toNumber(), csv: (r) => r.cogs.toNumber(), cell: (r) => formatUzs(r.cogs) },
    { key: 'gp', header: 'Валовая прибыль', align: 'right', sort: (r) => r.grossProfit.toNumber(), csv: (r) => r.grossProfit.toNumber(), cell: (r) => <Money value={r.grossProfit} signed /> },
    { key: 'sc', header: 'Расходы на реализацию', align: 'right', sort: (r) => r.sellingCosts.toNumber(), csv: (r) => r.sellingCosts.toNumber(), cell: (r) => formatUzs(r.sellingCosts) },
    { key: 'ct', header: 'Вклад товара', align: 'right', sort: (r) => r.contribution.toNumber(), csv: (r) => r.contribution.toNumber(), cell: (r) => <Money value={r.contribution} signed className="font-medium" /> },
    { key: 'mg', header: 'Маржа', align: 'right', sort: (r) => r.marginPct?.toNumber(), csv: (r) => r.marginPct?.toNumber() ?? null, cell: (r) => <Pct value={r.marginPct} /> },
  ]

  const batchCols: Column<BatchReportRow>[] = [
    { key: 'no', header: 'Партия', sort: (r) => batchNo(r.batchId), csv: (r) => batchNo(r.batchId), cell: (r) => { const b = db.purchase_batches.find((x) => x.id === r.batchId); return (<div><div className="font-medium">{batchNo(r.batchId)}</div><div className="text-xs text-muted-foreground">{b ? BATCH_STATUS_LABEL[b.status] : ''}</div></div>) } },
    { key: 'inv', header: 'Вложено', align: 'right', sort: (r) => r.invested.toNumber(), csv: (r) => r.invested.toNumber(), cell: (r) => formatUzs(r.invested) },
    { key: 'sold', header: 'Продано / доступно', align: 'right', sort: (r) => r.soldQty, csv: (r) => `${r.soldQty}/${r.qtyAvailable}`, cell: (r) => `${r.soldQty} / ${r.qtyAvailable}` },
    { key: 'rev', header: 'Выручка', align: 'right', sort: (r) => r.revenue.toNumber(), csv: (r) => r.revenue.toNumber(), cell: (r) => formatUzs(r.revenue) },
    { key: 'rec', header: 'Вернулось вложений', align: 'right', sort: (r) => r.recoveredPct?.toNumber(), csv: (r) => r.recoveredPct?.toNumber() ?? null, cell: (r) => <Pct value={r.recoveredPct} signed={false} /> },
    { key: 'real', header: 'Факт. результат', align: 'right', sort: (r) => r.realizedProfit.toNumber(), csv: (r) => r.realizedProfit.toNumber(), cell: (r) => <Money value={r.realizedProfit} signed /> },
    { key: 'plan', header: 'План. чистая прибыль', align: 'right', sort: (r) => r.plannedNetProfit.toNumber(), csv: (r) => r.plannedNetProfit.toNumber(), cell: (r) => <Money value={r.plannedNetProfit} signed /> },
    { key: 'roi', header: 'План. ROI', align: 'right', sort: (r) => r.plannedRoiPct?.toNumber(), csv: (r) => r.plannedRoiPct?.toNumber() ?? null, cell: (r) => <Pct value={r.plannedRoiPct} /> },
    { key: 'bep', header: 'Безубыточность, шт.', align: 'right', sort: (r) => r.breakEvenUnits, csv: (r) => r.breakEvenUnits, cell: (r) => (r.breakEvenUnits === null ? '—' : r.breakEvenUnits) },
    { key: 'pb', header: 'Окупаемость', align: 'right', sort: (r) => r.paybackDays, csv: (r) => r.paybackDays, cell: (r) => (r.paybackDays === null ? '—' : `${r.paybackDays} дн.`) },
  ]

  const periodCols: Column<SeriesPoint>[] = [
    { key: 'p', header: 'Период', sort: (r) => r.key, csv: (r) => r.label, cell: (r) => r.label },
    { key: 'rev', header: 'Выручка', align: 'right', sort: (r) => r.revenue, csv: (r) => r.revenue, cell: (r) => formatUzs(r.revenue) },
    { key: 'gp', header: 'Валовая прибыль', align: 'right', sort: (r) => r.grossProfit, csv: (r) => r.grossProfit, cell: (r) => <Money value={r.grossProfit} signed /> },
    { key: 'np', header: 'Чистая прибыль', align: 'right', sort: (r) => r.netProfit, csv: (r) => r.netProfit, cell: (r) => <Money value={r.netProfit} signed /> },
    { key: 'ci', header: 'Поступления', align: 'right', sort: (r) => r.cashIn, csv: (r) => r.cashIn, cell: (r) => formatUzs(r.cashIn) },
    { key: 'co', header: 'Платежи', align: 'right', sort: (r) => r.cashOut, csv: (r) => r.cashOut, cell: (r) => formatUzs(r.cashOut) },
    { key: 'net', header: 'Денежный поток', align: 'right', sort: (r) => r.cashIn - r.cashOut, csv: (r) => r.cashIn - r.cashOut, cell: (r) => <Money value={r.cashIn - r.cashOut} signed /> },
  ]

  const payments = useMemo(() => [...db.payments].sort((a, b) => b.payment_date.localeCompare(a.payment_date)), [db.payments])
  const paymentCols: Column<Payment>[] = [
    { key: 'date', header: 'Дата', sort: (p) => p.payment_date, csv: (p) => p.payment_date, cell: (p) => formatDate(p.payment_date) },
    { key: 'kind', header: 'Тип', sort: (p) => p.kind, csv: (p) => PAYMENT_KIND_LABEL[p.kind], cell: (p) => PAYMENT_KIND_LABEL[p.kind] },
    { key: 'batch', header: 'Партия', csv: (p) => (p.batch_id ? batchNo(p.batch_id) : ''), cell: (p) => (p.batch_id ? batchNo(p.batch_id) : '—') },
    { key: 'amt', header: 'Сумма', align: 'right', sort: (p) => p.amount_uzs, csv: (p) => p.amount, cell: (p) => formatMoney(p.amount, p.currency) },
    { key: 'cur', header: 'Валюта', csv: (p) => p.currency, cell: (p) => p.currency },
    { key: 'uzs', header: 'В UZS', align: 'right', sort: (p) => p.amount_uzs, csv: (p) => p.amount_uzs, cell: (p) => formatUzs(p.amount_uzs) },
    { key: 'st', header: 'Статус', csv: (p) => (p.status === 'paid' ? 'Проведён' : 'Запланирован'), cell: (p) => (p.status === 'paid' ? <Badge tone="success">проведён</Badge> : <Badge tone="warning">до {formatDate(p.due_date ?? p.payment_date)}</Badge>) },
    { key: 'note', header: 'Комментарий', csv: (p) => p.note ?? '', cell: (p) => <span className="text-muted-foreground">{p.note}</span> },
    {
      key: 'act',
      header: '',
      align: 'right',
      cell: (p) => (
        <div className="flex justify-end gap-0.5">
          {p.status === 'scheduled' && <Button variant="ghost" size="icon" aria-label="Провести платёж" title="Провести платёж" onClick={() => void run(() => markPaymentPaid(p.id), 'Платёж проведён')}><CheckCircle2 className="text-success" /></Button>}
          <Button variant="ghost" size="icon" aria-label="Изменить" onClick={() => setEditing(p)}><Pencil /></Button>
          <Button variant="ghost" size="icon" aria-label="Удалить" onClick={async () => { if (await confirm({ title: 'Удалить платёж?', confirmLabel: 'Удалить', destructive: true })) await run(() => deletePayment(p.id), 'Платёж удалён') }}><Trash2 className="text-danger" /></Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Финансы и прибыль"
        description="Выручка, прибыль, денежный поток, задолженности и запасы — отдельно друг от друга. Плановые и фактические показатели не смешиваются."
        actions={<PeriodPicker />}
      />
      <Tabs defaultValue="pnl">
        <TabsList>
          <TabsTrigger value="pnl">Прибыль и убытки</TabsTrigger>
          <TabsTrigger value="cash">Деньги и баланс</TabsTrigger>
          <TabsTrigger value="payments">Платежи</TabsTrigger>
          <TabsTrigger value="products">По товарам</TabsTrigger>
          <TabsTrigger value="batches">По партиям</TabsTrigger>
          <TabsTrigger value="periods">По периодам</TabsTrigger>
        </TabsList>

        <TabsContent value="pnl" className="mt-3">
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Выручка" value={formatUzs(m.revenue)} sub="признанные продажи" />
            <StatCard label="Валовая прибыль" value={formatUzs(m.grossProfit)} tone={m.grossProfit.isNegative() ? 'danger' : 'neutral'} />
            <StatCard label="Операционная прибыль" value={formatUzs(m.operatingProfit)} tone={m.operatingProfit.isNegative() ? 'danger' : 'neutral'} />
            <StatCard label="Чистая прибыль" value={formatUzs(m.netProfit)} tone={m.netProfit.isNegative() ? 'danger' : 'success'} sub={m.netMarginPct ? `маржа ${formatNumber(m.netMarginPct, 1)}%` : undefined} />
          </div>
          <Card>
            <CardHeader title="Отчёт о прибылях и убытках" description={`${formatDate(range.from)} — ${formatDate(range.to)}`} />
            <CardBody>
              <KeyValue
                rows={[
                  { label: 'Продажи по ценам', value: formatUzs(m.grossSales) },
                  { label: '− скидки продавца', value: formatUzs(m.discounts), indent: true },
                  { label: '− возвраты покупателям', value: formatUzs(m.refunds), indent: true },
                  { label: 'Выручка', value: formatUzs(m.revenue), strong: true, border: true },
                  { label: '− себестоимость проданных товаров', value: formatUzs(m.cogs), indent: true },
                  { label: 'Валовая прибыль', value: <Money value={m.grossProfit} signed />, strong: true, border: true },
                  { label: '− комиссия Uzum', value: formatUzs(m.commission), indent: true },
                  { label: '− логистика и обработка Uzum', value: formatUzs(m.logisticsUzum), indent: true },
                  { label: '− прочие удержания', value: formatUzs(m.otherDeductions), indent: true },
                  { label: '− реклама', value: formatUzs(m.ads), indent: true },
                  { label: '− упаковка и доп. расходы на продажу', value: formatUzs(m.packaging.plus(m.extra)), indent: true },
                  { label: '− логистика возвратов', value: formatUzs(m.returnLogistics), indent: true },
                  { label: '+ компенсации', value: formatUzs(m.compensation), indent: true },
                  { label: '− операционные расходы периода', value: formatUzs(m.opex), indent: true },
                  { label: '− списания и брак', value: formatUzs(m.losses), indent: true },
                  { label: 'Операционная прибыль', value: <Money value={m.operatingProfit} signed />, strong: true, border: true },
                  { label: `− ${taxLabel}`, value: formatUzs(m.tax), indent: true },
                  { label: 'Чистая прибыль', value: <Money value={m.netProfit} signed />, strong: true, border: true },
                ]}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                Закупка и расходы партий уже входят в себестоимость проданных единиц, поэтому отдельно не вычитаются. Непроданный товар остаётся в запасах и в прибыль не попадает.
              </p>
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="cash" className="mt-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Денежный поток за период" description="Реальные поступления и платежи (кассовый метод)" />
              <CardBody>
                <KeyValue
                  rows={[
                    { label: 'Поступления (полученные выплаты Uzum, компенсации)', value: formatUzs(m.cashIn) },
                    { label: 'Платежи (закупки, расходы, возвраты)', value: formatUzs(m.cashOut) },
                    { label: 'Чистый денежный поток', value: <Money value={m.netCash} signed />, strong: true, border: true },
                  ]}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Баланс на сегодня" description="Не зависит от выбранного периода" />
              <CardBody>
                <KeyValue
                  rows={[
                    { label: 'Вложенный капитал владельца (взносы − вывод)', value: formatUzs(snap.ownerCapital) },
                    { label: 'Вложено в закупки (полная стоимость партий)', value: formatUzs(snap.investedInPurchases) },
                    { label: 'Остаточная стоимость запасов', value: formatUzs(snap.inventoryValue), strong: true },
                    { label: 'Дебиторская задолженность (выплаты Uzum впереди)', value: formatUzs(snap.receivable), border: true },
                    { label: 'Кредиторская задолженность', value: formatUzs(snap.payable) },
                    { label: 'долг поставщикам', value: formatUzs(snap.supplierDebt), indent: true },
                    { label: 'неоплаченные расходы', value: formatUzs(snap.pendingExpenses), indent: true },
                    { label: 'Вложено, но не возвращено продажами', value: formatUzs(snap.notYetReturned), strong: true, border: true },
                  ]}
                />
              </CardBody>
            </Card>
          </div>
          <Notice tone="primary" className="mt-3">Выручка, прибыль, денежный поток и стоимость запасов — разные показатели: деньги могут быть вложены в товар на складе, а прибыль ещё не получена.</Notice>
        </TabsContent>

        <TabsContent value="payments" className="mt-3">
          <DataTable
            rows={payments}
            columns={paymentCols}
            rowKey={(p) => p.id}
            searchText={(p) => `${PAYMENT_KIND_LABEL[p.kind]} ${p.note ?? ''} ${p.batch_id ? batchNo(p.batch_id) : ''}`}
            defaultSort={{ key: 'date', dir: 'desc' }}
            exportName="platezhi"
            empty="Платежей пока нет. Здесь учитываются оплаты поставщикам и вложения/вывод владельца."
            toolbar={<Button size="sm" onClick={() => setEditing('new')}><Plus /> Добавить платёж</Button>}
          />
        </TabsContent>
        <TabsContent value="products" className="mt-3">
          <DataTable rows={prodRep} columns={productCols} rowKey={(r) => r.productId} searchText={(r) => productName(r.productId)} defaultSort={{ key: 'ct', dir: 'desc' }} exportName="otchet-po-tovaram" empty="За период не было продаж." />
        </TabsContent>
        <TabsContent value="batches" className="mt-3">
          <DataTable rows={batchRep} columns={batchCols} rowKey={(r) => r.batchId} searchText={(r) => batchNo(r.batchId)} defaultSort={{ key: 'no', dir: 'desc' }} exportName="otchet-po-partiyam" empty="Партий пока нет." />
        </TabsContent>
        <TabsContent value="periods" className="mt-3">
          <DataTable
            rows={series}
            columns={periodCols}
            rowKey={(r) => r.key}
            defaultSort={{ key: 'p', dir: 'desc' }}
            pageSize={20}
            exportName="otchet-po-periodam"
            toolbar={<Segmented value={gran} onChange={setGran} options={[{ value: 'day', label: 'По дням' }, { value: 'week', label: 'По неделям' }, { value: 'month', label: 'По месяцам' }]} />}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Новый платёж' : 'Изменить платёж'}>
        {editing !== null && <PaymentForm payment={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      </Dialog>
    </>
  )
}

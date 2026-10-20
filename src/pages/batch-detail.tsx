import { ArrowLeft, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DataTable, type Column } from '@/components/data-table'
import { KeyValue, Money, Notice, PageHeader, Pct, StatCard } from '@/components/common'
import { BatchForm } from '@/components/forms/batch-form'
import { ExpenseForm } from '@/components/forms/expense-form'
import { PAYMENT_KIND_LABEL, PaymentForm } from '@/components/forms/payment-form'
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, useConfirm } from '@/components/ui/dialog'
import { Select } from '@/components/ui/form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { deleteBatch, deleteExpense, deletePayment, markPaymentPaid, setBatchStatus } from '@/data/actions'
import { useAppState, useDerived } from '@/data/store'
import { useAction } from '@/hooks/use-action'
import { sellingParamsFor } from '@/lib/calc/derive'
import { estimateCargo } from '@/lib/calc/batch'
import { batchReport } from '@/lib/calc/finance'
import { unitEconomics } from '@/lib/calc/unit'
import { ALLOCATION_LABEL, BATCH_STATUSES, BATCH_STATUS_LABEL } from '@/lib/constants'
import { kgToG } from '@/lib/weight'
import { formatDate, formatMoney, formatNumber, formatUzs } from '@/lib/format'
import type { Expense, Payment } from '@/types/db'

export default function BatchDetailPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { db } = useAppState()
  const d = useDerived()
  const confirm = useConfirm()
  const { run } = useAction()
  const [editing, setEditing] = useState(false)
  const [expense, setExpense] = useState<Expense | 'new' | null>(null)
  const [payment, setPayment] = useState<Payment | 'new' | null>(null)

  const batch = db.purchase_batches.find((b) => b.id === id)
  const calc = d.batchCalcs.get(id)
  const report = useMemo(() => batchReport(d.finance).find((r) => r.batchId === id), [d, id])

  if (!batch || !calc) {
    return (
      <>
        <PageHeader title="Партия не найдена" />
        <Notice tone="warning">Возможно, партия была удалена. <Link to="/batches" className="underline">Вернуться к списку</Link></Notice>
      </>
    )
  }

  const supplier = db.suppliers.find((s) => s.id === batch.supplier_id)
  const expenses = db.expenses.filter((e) => e.batch_id === id).sort((a, b) => b.expense_date.localeCompare(a.expense_date))
  const payments = db.payments.filter((p) => p.batch_id === id && p.kind === 'supplier')
  const cat = (cid: string) => db.categories.find((c) => c.id === cid)?.name ?? '—'
  const productName = (pid: string) => d.productsById.get(pid)?.name ?? 'Товар'
  const cargoEst = estimateCargo(batch)
  const hasCargoExpense = expenses.some((e) => db.categories.find((c) => c.id === e.category_id)?.code === 'cargo')

  const onDelete = async () => {
    const ok = await confirm({
      title: `Удалить партию ${batch.batch_no}?`,
      description: 'Будут удалены позиции, расходы и платежи партии и связанные приходы на склад. Это необратимо.',
      confirmLabel: 'Удалить',
      destructive: true,
    })
    if (ok && (await run(() => deleteBatch(batch.id), 'Партия удалена'))) nav('/batches')
  }

  const expenseCols: Column<Expense>[] = [
    { key: 'date', header: 'Дата', sort: (e) => e.expense_date, csv: (e) => e.expense_date, cell: (e) => formatDate(e.expense_date) },
    { key: 'cat', header: 'Статья', sort: (e) => cat(e.category_id), csv: (e) => cat(e.category_id), cell: (e) => cat(e.category_id) },
    {
      key: 'scope',
      header: 'Относится к',
      cell: (e) => (e.batch_item_id ? productName(d.itemsByBatch.get(id)?.find((i) => i.id === e.batch_item_id)?.product_id ?? '') : <span className="text-muted-foreground">Вся партия · {ALLOCATION_LABEL[e.allocation_method ?? batch.allocation_method].toLowerCase()}</span>),
    },
    { key: 'amount', header: 'Сумма', align: 'right', sort: (e) => e.amount, csv: (e) => e.amount, cell: (e) => formatMoney(e.amount, e.currency) },
    { key: 'uzs', header: 'В UZS', align: 'right', sort: (e) => e.amount_uzs, csv: (e) => e.amount_uzs, cell: (e) => formatUzs(e.amount_uzs) },
    { key: 'st', header: 'Оплата', cell: (e) => <Badge tone={e.payment_status === 'paid' ? 'success' : 'warning'}>{e.payment_status === 'paid' ? 'Оплачено' : `К оплате${e.due_date ? ` до ${formatDate(e.due_date)}` : ''}`}</Badge> },
    { key: 'cm', header: 'Комментарий', csv: (e) => e.comment ?? '', cell: (e) => <span className="block max-w-48 truncate text-muted-foreground" title={e.comment ?? ''}>{e.comment}</span> },
    {
      key: 'act',
      header: '',
      align: 'right',
      cell: (e) => (
        <div className="flex justify-end gap-0.5">
          <Button variant="ghost" size="icon" aria-label="Изменить" onClick={() => setExpense(e)}><Pencil /></Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Удалить"
            onClick={async () => {
              if (await confirm({ title: 'Удалить расход?', description: 'Себестоимость партии пересчитается.', confirmLabel: 'Удалить', destructive: true }))
                await run(() => deleteExpense(e.id), 'Расход удалён')
            }}
          >
            <Trash2 className="text-danger" />
          </Button>
        </div>
      ),
    },
  ]

  const paymentCols: Column<Payment>[] = [
    { key: 'date', header: 'Дата', sort: (p) => p.payment_date, cell: (p) => formatDate(p.status === 'scheduled' ? p.due_date : p.payment_date) },
    { key: 'kind', header: 'Тип', cell: (p) => PAYMENT_KIND_LABEL[p.kind] },
    { key: 'amount', header: 'Сумма', align: 'right', sort: (p) => p.amount, cell: (p) => formatMoney(p.amount, p.currency) },
    { key: 'uzs', header: 'В UZS', align: 'right', cell: (p) => formatUzs(p.amount_uzs) },
    { key: 'st', header: 'Статус', cell: (p) => <Badge tone={p.status === 'paid' ? 'success' : 'warning'}>{p.status === 'paid' ? 'Проведён' : 'Запланирован'}</Badge> },
    {
      key: 'act',
      header: '',
      align: 'right',
      cell: (p) => (
        <div className="flex justify-end gap-0.5">
          {p.status === 'scheduled' && <Button size="sm" variant="outline" onClick={() => void run(() => markPaymentPaid(p.id), 'Платёж проведён')}>Оплачен</Button>}
          <Button variant="ghost" size="icon" aria-label="Изменить" onClick={() => setPayment(p)}><Pencil /></Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Удалить"
            onClick={async () => {
              if (await confirm({ title: 'Удалить платёж?', confirmLabel: 'Удалить', destructive: true })) await run(() => deletePayment(p.id), 'Платёж удалён')
            }}
          >
            <Trash2 className="text-danger" />
          </Button>
        </div>
      ),
    },
  ]

  const receivedPart = calc.qtyReceived > 0

  return (
    <>
      <Link to="/batches" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Все партии
      </Link>
      <PageHeader
        title={`Партия ${batch.batch_no}`}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Заказана {formatDate(batch.order_date)}</span>
            {supplier && <span>· {supplier.name}</span>}
            {batch.received_date && <span>· получена {formatDate(batch.received_date)}</span>}
            <span>· курс {formatNumber(batch.cny_rate, 2)} сум/¥</span>
            {batch.order_url && (
              <a href={batch.order_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
                заказ <ExternalLink className="size-3" />
              </a>
            )}
          </span>
        }
        actions={
          <>
            <Select
              aria-label="Статус партии"
              value={batch.status}
              onChange={(e) => void run(() => setBatchStatus(batch.id, e.target.value as typeof batch.status), 'Статус обновлён')}
              className="w-40"
            >
              {BATCH_STATUSES.map((s) => (
                <option key={s} value={s}>{BATCH_STATUS_LABEL[s]}</option>
              ))}
            </Select>
            <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> Изменить</Button>
            <Button variant="outline" onClick={() => void onDelete()}><Trash2 className="text-danger" /> Удалить</Button>
          </>
        }
      />

      {calc.warnings.length > 0 && (
        <div className="mb-4 space-y-2">
          {calc.warnings.map((w, i) => <Notice key={i} tone="warning">{w}</Notice>)}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Полная стоимость партии" value={formatUzs(calc.totalCostUzs)} sub={`товары ${formatUzs(calc.goodsUzs)}`} />
        <StatCard label="Себестоимость единицы (средняя)" value={calc.unitCostAvgUzs ? formatUzs(calc.unitCostAvgUzs) : '—'} sub={`${formatNumber(calc.qtyAvailable)} годных шт.`} />
        <StatCard label="Плановая чистая прибыль" value={formatUzs(calc.plannedNetProfit)} tone={calc.plannedNetProfit.isNegative() ? 'danger' : 'success'} sub={calc.roiPct ? `ROI ${formatNumber(calc.roiPct, 1)}%` : undefined} />
        <StatCard
          label="Долг поставщику"
          value={formatMoney(calc.debtCny, 'CNY')}
          tone={calc.debtCny.gt(0) ? 'warning' : 'neutral'}
          sub={`≈ ${formatUzs(calc.debtUzs)}`}
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Финансовая карточка</TabsTrigger>
          <TabsTrigger value="items">Товары ({calc.items.length})</TabsTrigger>
          <TabsTrigger value="expenses">Расходы ({expenses.length})</TabsTrigger>
          <TabsTrigger value="payments">Оплата поставщику</TabsTrigger>
          <TabsTrigger value="fact">План и факт</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader title="Стоимость и вложения" />
              <CardBody>
                <KeyValue
                  rows={[
                    { label: 'Закупка товаров, CNY', value: formatMoney(calc.goodsCny, 'CNY') },
                    { label: 'Закупка товаров, UZS (по курсу партии)', value: <Money value={calc.goodsUzs} /> },
                    { label: 'Логистика (карго, забор, доставки)', value: <Money value={calc.logisticsUzs} /> },
                    { label: 'Дополнительные расходы (таможня, посредник, документы…)', value: <Money value={calc.otherExtrasUzs} /> },
                    { label: 'Полная стоимость партии', value: <Money value={calc.totalCostUzs} />, strong: true, border: true },
                    { label: 'Вложено с учётом расходов на реализацию (план)', value: <Money value={calc.investedUzs} /> },
                    { label: 'Себестоимость единицы (средняя)', value: calc.unitCostAvgUzs ? <Money value={calc.unitCostAvgUzs} /> : '—', strong: true },
                  ]}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Количество" />
              <CardBody>
                <KeyValue
                  rows={[
                    { label: 'Заказано', value: `${formatNumber(calc.qtyOrdered)} шт.` },
                    { label: 'Получено', value: `${formatNumber(calc.qtyReceived)} шт.` },
                    { label: 'Брак', value: <span className={calc.qtyDefective > 0 ? 'text-danger' : ''}>{formatNumber(calc.qtyDefective)} шт.</span> },
                    { label: 'Доступно для продажи', value: `${formatNumber(calc.qtyAvailable)} шт.`, strong: true, border: true },
                    { label: 'Продано', value: `${formatNumber(report?.soldQty ?? 0)} шт.` },
                    { label: 'Осталось', value: `${formatNumber(report?.remainingQty ?? calc.qtyAvailable)} шт.` },
                  ]}
                />
                {!receivedPart && <p className="mt-2 text-xs text-muted-foreground">Партия ещё не получена: расчёт идёт по заказанному количеству.</p>}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="План при продаже всей партии" description="По плановым ценам позиций, текущим комиссиям и тарифам Uzum" />
              <CardBody>
                <KeyValue
                  rows={[
                    { label: 'Плановая выручка', value: <Money value={calc.plannedRevenue} /> },
                    { label: 'Плановая валовая прибыль (выручка − стоимость партии)', value: <Money value={calc.plannedGrossProfit} signed /> },
                    { label: 'Расходы на реализацию (комиссия, логистика Uzum, упаковка)', value: <Money value={calc.plannedSellingCosts} /> },
                    { label: 'Плановая чистая прибыль', value: <Money value={calc.plannedNetProfit} signed />, strong: true, border: true },
                    { label: 'ROI', value: <Pct value={calc.roiPct} /> },
                    { label: 'Точка безубыточности', value: calc.breakEvenUnits === null ? <span className="text-danger">не окупится</span> : `${formatNumber(calc.breakEvenUnits)} шт.` },
                    { label: 'Срок окупаемости', value: calc.paybackDays === null ? <span className="text-muted-foreground">укажите продажи/мес. в товарах</span> : `~${formatNumber(calc.paybackDays)} дн.` },
                  ]}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Расчёты с поставщиком" />
              <CardBody>
                <KeyValue
                  rows={[
                    { label: 'Стоимость товара', value: formatMoney(calc.goodsCny, 'CNY') },
                    { label: 'Предоплата', value: formatMoney(batch.prepayment_cny, 'CNY') },
                    { label: 'Оплачено дополнительно', value: formatMoney(calc.paidCny.minus(batch.prepayment_cny), 'CNY') },
                    { label: 'Остаток задолженности', value: <span className={calc.debtCny.gt(0) ? 'text-warning' : ''}>{formatMoney(calc.debtCny, 'CNY')}</span>, strong: true, border: true },
                    { label: 'Тариф карго', value: `${formatNumber(batch.cargo_tariff_kg, 2)} ${batch.cargo_currency}/кг` },
                    { label: 'Вес / объём груза', value: `${formatNumber(kgToG(batch.actual_weight_kg), 0)} г / ${formatNumber(batch.volume_m3, 3)} м³` },
                  ]}
                />
                {cargoEst.amount.gt(0) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    По тарифу карго ≈ {formatNumber(cargoEst.amount, 2)} {batch.cargo_currency} (по {cargoEst.basis === 'weight' ? 'весу' : 'объёму'}).
                    {!hasCargoExpense && ' Расход «Карго» пока не добавлен — добавьте его на вкладке «Расходы».'}
                  </p>
                )}
              </CardBody>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="items">
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Товар</th>
                  <th className="px-3 py-2 text-right font-medium">Заказано</th>
                  <th className="px-3 py-2 text-right font-medium">Получено / брак</th>
                  <th className="px-3 py-2 text-right font-medium">Товар, UZS</th>
                  <th className="px-3 py-2 text-right font-medium">Доля расходов</th>
                  <th className="px-3 py-2 text-right font-medium">Итого</th>
                  <th className="px-3 py-2 text-right font-medium">Себестоимость ед.</th>
                  <th className="px-3 py-2 text-right font-medium">План. цена</th>
                  <th className="px-3 py-2 text-right font-medium">План. прибыль/ед.</th>
                </tr>
              </thead>
              <tbody>
                {calc.items.map((it) => {
                  const product = d.productsById.get(it.product_id)
                  const sp = sellingParamsFor(db, product, batch.order_date)
                  const u = it.unitCostUzs
                    ? unitEconomics({ price: it.plannedPrice, commissionPct: sp.commissionPct, logistics: sp.logistics, otherPct: sp.otherPct, packaging: sp.packaging, extra: sp.extra, unitCost: it.unitCostUzs })
                    : null
                  return (
                    <tr key={it.item_id} className="border-b last:border-0">
                      <td className="px-3 py-2.5 font-medium">{productName(it.product_id)}</td>
                      <td className="num px-3 py-2.5 text-right">{formatNumber(it.qtyOrdered)}</td>
                      <td className="num px-3 py-2.5 text-right">{it.isReceived ? `${formatNumber(it.qtyReceived)} / ${formatNumber(it.qtyDefective)}` : '—'}</td>
                      <td className="px-3 py-2.5 text-right"><Money value={it.goodsUzs} /></td>
                      <td className="px-3 py-2.5 text-right"><Money value={it.allocatedUzs} /></td>
                      <td className="px-3 py-2.5 text-right"><Money value={it.totalUzs} /></td>
                      <td className="px-3 py-2.5 text-right font-medium">{it.unitCostUzs ? <Money value={it.unitCostUzs} /> : '—'}</td>
                      <td className="px-3 py-2.5 text-right"><Money value={it.plannedPrice} /></td>
                      <td className="px-3 py-2.5 text-right">{u ? <Money value={u.profit} signed /> : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Общие расходы партии распределяются между товарами методом «{ALLOCATION_LABEL[batch.allocation_method].toLowerCase()}»; расходы, привязанные к товару, целиком относятся к нему. Сумма долей всегда равна сумме расходов.
          </p>
        </TabsContent>

        <TabsContent value="expenses">
          <DataTable
            rows={expenses}
            columns={expenseCols}
            rowKey={(e) => e.id}
            searchText={(e) => `${cat(e.category_id)} ${e.comment ?? ''}`}
            exportName={`расходы_${batch.batch_no}`}
            toolbar={<Button size="sm" onClick={() => setExpense('new')}><Plus /> Добавить расход</Button>}
            empty="Расходов по партии пока нет. Добавьте карго, таможню, услуги посредника и другие затраты — они войдут в себестоимость."
            defaultSort={{ key: 'date', dir: 'desc' }}
            footer={
              <tr className="border-t bg-muted/30 font-medium">
                <td className="px-3 py-2" colSpan={4}>Итого расходов партии</td>
                <td className="num px-3 py-2 text-right">{formatUzs(calc.extrasUzs)}</td>
                <td colSpan={3} />
              </tr>
            }
          />
        </TabsContent>

        <TabsContent value="payments">
          <DataTable
            rows={payments}
            columns={paymentCols}
            rowKey={(p) => p.id}
            toolbar={<Button size="sm" onClick={() => setPayment('new')}><Plus /> Добавить платёж</Button>}
            empty={`Платежей нет. Предоплата ${formatMoney(batch.prepayment_cny, 'CNY')} указана в самой партии.`}
          />
        </TabsContent>

        <TabsContent value="fact">
          <Card>
            <CardBody>
              {report ? (
                <KeyValue
                  rows={[
                    { label: 'Продано единиц партии', value: `${formatNumber(report.soldQty)} из ${formatNumber(report.qtyAvailable)}` },
                    { label: 'Выручка по проданной части', value: <Money value={report.revenue} /> },
                    { label: 'Себестоимость проданной части', value: <Money value={report.costOfSold} /> },
                    { label: 'Расходы на реализацию (комиссия, логистика Uzum, упаковка…)', value: <Money value={report.sellingCosts} /> },
                    { label: 'Фактический результат реализованной части', value: <Money value={report.realizedProfit} signed />, strong: true, border: true },
                    { label: 'Вернулось от вложенного', value: <Pct value={report.recoveredPct} signed={false} /> },
                    { label: 'Плановая чистая прибыль всей партии', value: <Money value={report.plannedNetProfit} signed /> },
                  ]}
                />
              ) : null}
              <p className="mt-3 text-xs text-muted-foreground">
                Проданные единицы привязываются к партиям по принципу FIFO (раньше поступившая партия продаётся первой). Факт и план не смешиваются: план считается по плановым ценам позиций, факт — по реальным продажам.
              </p>
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={editing} onOpenChange={setEditing} title={`Партия ${batch.batch_no}`} size="xl">
        {editing && <BatchForm batch={batch} onClose={() => setEditing(false)} />}
      </Dialog>
      <Dialog open={expense !== null} onOpenChange={(o) => !o && setExpense(null)} title={expense === 'new' ? 'Новый расход партии' : 'Редактирование расхода'}>
        {expense !== null && <ExpenseForm key={expense === 'new' ? 'n' : expense.id} expense={expense === 'new' ? null : expense} presetBatchId={batch.id} onClose={() => setExpense(null)} />}
      </Dialog>
      <Dialog open={payment !== null} onOpenChange={(o) => !o && setPayment(null)} title={payment === 'new' ? 'Платёж поставщику' : 'Редактирование платежа'}>
        {payment !== null && <PaymentForm key={payment === 'new' ? 'n' : payment.id} payment={payment === 'new' ? null : payment} presetBatchId={batch.id} onClose={() => setPayment(null)} />}
      </Dialog>
    </>
  )
}

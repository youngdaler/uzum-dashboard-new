import { AlertTriangle, Banknote, Boxes, CalendarClock, CornerUpLeft, Hourglass, PackageCheck, Percent, Receipt, ShoppingCart, TrendingUp, Truck, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts'
import { axisUzs, CHART_COLORS, Chart, ChartTooltip, NoData } from '@/components/charts'
import { EmptyState, Money, PageHeader, StatCard } from '@/components/common'
import { PeriodPicker, usePeriod } from '@/components/period-picker'
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card'
import { Segmented } from '@/components/ui/tabs'
import { useAppState, useDerived } from '@/data/store'
import {
  batchReport,
  buildSeries,
  defaultGranularity,
  expensesByGroup,
  EXPENSE_GROUPS,
  periodMetrics,
  previousRange,
  productReport,
  snapshot,
  type Granularity,
} from '@/lib/calc/finance'
import { buildProductRows } from '@/lib/productStats'
import { formatDate, formatNumber, formatPct, formatUzs, todayIso } from '@/lib/format'
import { D } from '@/lib/money'

const delta = (cur: number, prev: number): number | null => (prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100)
const GRAN_LABEL: { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Дни' },
  { value: 'week', label: 'Недели' },
  { value: 'month', label: 'Месяцы' },
]

interface Op {
  key: string
  date: string
  kind: string
  title: string
  amount: number
  sign: 1 | -1 | 0
}

export default function Dashboard() {
  const { db } = useAppState()
  const d = useDerived()
  const range = usePeriod()
  const [gran, setGran] = useState<Granularity | null>(null)
  const g = gran ?? defaultGranularity(range)
  const fin = d.finance
  const today = todayIso()

  const m = useMemo(() => periodMetrics(fin, range), [fin, range])
  const prev = useMemo(() => periodMetrics(fin, previousRange(range)), [fin, range])
  const snap = useMemo(() => snapshot(fin), [fin])
  const series = useMemo(() => buildSeries(fin, range, g), [fin, range, g])
  const groups = useMemo(() => expensesByGroup(fin, range), [fin, range])
  const prodRep = useMemo(() => productReport(fin, range), [fin, range])
  const batchRep = useMemo(() => batchReport(fin), [fin])
  const rows = useMemo(() => buildProductRows(db, d, today), [db, d, today])

  const lowStock = rows.filter((r) => r.product.status === 'active' && r.stock && r.product.min_stock > 0 && r.stock.available <= r.product.min_stock)
  const losing = rows.filter((r) => r.product.status === 'active' && r.unit && r.unit.profit.isNegative())
  const empty = db.products.length === 0 && db.sales.length === 0 && db.purchase_batches.length === 0

  const expenseData = EXPENSE_GROUPS.map((n) => ({ name: n, value: groups[n].toNumber() })).filter((x) => x.value > 0)
  const productData = prodRep
    .map((r) => ({ name: d.productsById.get(r.productId)?.name ?? '—', value: r.contribution.toNumber() }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
  const batchData = batchRep
    .map((r) => {
      const b = db.purchase_batches.find((x) => x.id === r.batchId)
      return { name: b?.batch_no ?? '—', invested: r.invested.toNumber(), recovered: r.revenue.minus(r.sellingCosts).toNumber(), profit: r.realizedProfit.toNumber() }
    })
    .slice(-8)
  const costStructure = (() => {
    let goods = D(0)
    let logistics = D(0)
    let extras = D(0)
    for (const c of d.batchCalcs.values()) {
      goods = goods.plus(c.goodsUzs)
      logistics = logistics.plus(c.logisticsUzs)
      extras = extras.plus(c.otherExtrasUzs)
    }
    return [
      { name: 'Товар', value: goods.toNumber() },
      { name: 'Логистика', value: logistics.toNumber() },
      { name: 'Прочие расходы партий', value: extras.toNumber() },
    ].filter((x) => x.value > 0)
  })()
  const stockTimeline = fin.inventory.timeline
    .filter((p) => p.date >= range.from && p.date <= range.to)
    .map((p) => ({ date: formatDate(p.date), value: p.value.toNumber(), qty: p.qty }))

  const upcoming = useMemo(() => {
    const items: { key: string; date: string | null; title: string; amount: number; overdue: boolean }[] = []
    for (const p of db.payments) if (p.status === 'scheduled' && p.kind !== 'owner_in') items.push({ key: `p${p.id}`, date: p.due_date ?? p.payment_date, title: p.note || 'Платёж поставщику', amount: p.amount_uzs, overdue: (p.due_date ?? p.payment_date) < today })
    for (const e of db.expenses) if (e.payment_status === 'pending') items.push({ key: `e${e.id}`, date: e.due_date, title: e.comment || d.categoriesById.get(e.category_id)?.name || 'Расход', amount: e.amount_uzs, overdue: !!e.due_date && e.due_date < today })
    for (const b of db.purchase_batches) {
      const c = d.batchCalcs.get(b.id)
      if (c && c.debtUzs.gt(0) && b.status !== 'closed') items.push({ key: `b${b.id}`, date: null, title: `Долг поставщику · ${b.batch_no}`, amount: c.debtUzs.toNumber(), overdue: false })
    }
    return items.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999')).slice(0, 8)
  }, [db, d, today])

  const recent = useMemo<Op[]>(() => {
    const ops: Op[] = []
    for (const l of fin.lines) ops.push({ key: `s${l.saleItemId}`, date: l.date, kind: 'Продажа', title: `${l.orderNo} · ${d.productsById.get(l.productId)?.name ?? ''}`, amount: l.revenue.toNumber(), sign: 1 })
    for (const e of db.expenses) ops.push({ key: `e${e.id}`, date: e.expense_date, kind: 'Расход', title: e.comment || d.categoriesById.get(e.category_id)?.name || '', amount: e.amount_uzs, sign: -1 })
    for (const b of db.purchase_batches) ops.push({ key: `b${b.id}`, date: b.order_date, kind: 'Партия', title: b.batch_no, amount: d.batchCalcs.get(b.id)?.goodsUzs.toNumber() ?? 0, sign: -1 })
    for (const r of db.returns) ops.push({ key: `r${r.id}`, date: r.return_date, kind: 'Возврат', title: r.kind === 'return' ? 'Возврат товара' : 'Повреждённый товар', amount: r.refund_uzs, sign: -1 })
    return ops.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)
  }, [fin, db, d])

  if (empty)
    return (
      <>
        <PageHeader title="Дашборд" />
        <Card>
          <EmptyState icon={TrendingUp} title="Пока нет данных" description="Добавьте товары, партии и продажи — или загрузите демо-данные в разделе «Настройки», чтобы посмотреть, как всё работает." action={<Link className="text-sm font-medium text-primary hover:underline" to="/settings">Открыть настройки</Link>} />
        </Card>
      </>
    )

  const profitTone = m.netProfit.isNegative() ? 'danger' : 'success'

  return (
    <>
      <PageHeader title="Дашборд" description={`Период: ${formatDate(range.from)} — ${formatDate(range.to)}. Прибыль считается по проданным единицам, непроданный товар остаётся в запасах.`} actions={<PeriodPicker />} />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <StatCard label="Выручка" value={formatUzs(m.revenue)} icon={Banknote} delta={delta(m.revenue.toNumber(), prev.revenue.toNumber())} sub="после скидок и возвратов" />
        <StatCard label="Проданных единиц" value={formatNumber(m.unitsSold)} icon={ShoppingCart} delta={delta(m.unitsSold, prev.unitsSold)} sub={`${m.orders} заказов`} />
        <StatCard label="Себестоимость проданного" value={formatUzs(m.cogs)} icon={PackageCheck} />
        <StatCard label="Валовая прибыль" value={formatUzs(m.grossProfit)} icon={TrendingUp} tone={m.grossProfit.isNegative() ? 'danger' : 'neutral'} delta={delta(m.grossProfit.toNumber(), prev.grossProfit.toNumber())} sub="выручка − себестоимость" />
        <StatCard label="Чистая прибыль" value={formatUzs(m.netProfit)} icon={Wallet} tone={profitTone} delta={delta(m.netProfit.toNumber(), prev.netProfit.toNumber())} sub="после расходов и налогов" />
        <StatCard label="Рентабельность продаж" value={formatPct(m.netMarginPct)} icon={Percent} tone={m.netMarginPct && m.netMarginPct.isNegative() ? 'danger' : 'neutral'} sub="чистая прибыль / выручка" />
        <StatCard label="Вложено в закупки" value={formatUzs(snap.investedInPurchases)} icon={Truck} sub={`${snap.activeBatches} активных партий`} />
        <StatCard label="Товары на складе" value={formatUzs(snap.inventoryValue)} icon={Boxes} sub={`${formatNumber(snap.inventoryQty)} шт. по себестоимости`} />
        <StatCard label="Не возвращено продажами" value={formatUzs(snap.notYetReturned)} icon={Hourglass} tone={snap.notYetReturned.gt(0) ? 'warning' : 'neutral'} hint="Вложено в закупки минус полученные выплаты Uzum" sub="закупки − полученные выплаты" />
        <StatCard label="Низкие остатки" value={formatNumber(lowStock.length)} icon={AlertTriangle} tone={lowStock.length ? 'warning' : 'neutral'} sub="товаров ниже минимума" />
        <StatCard label="Возвраты / отмены" value={`${m.returnedUnits} / ${m.cancelledOrders}`} icon={CornerUpLeft} sub="возвращено шт. / отменено заказов" />
        <StatCard label="Денежный поток" value={formatUzs(m.netCash)} icon={Receipt} tone={m.netCash.isNegative() ? 'danger' : 'neutral'} sub="поступления − платежи" />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Выручка и чистая прибыль" action={<Segmented value={g} onChange={setGran} options={GRAN_LABEL} />} />
          <CardBody>
            {series.every((p) => p.revenue === 0 && p.netProfit === 0) ? (
              <NoData />
            ) : (
              <Chart>
                <AreaChart data={series}>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={axisUzs} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={72} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="revenue" name="Выручка" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.12} strokeWidth={2} />
                  <Area type="monotone" dataKey="netProfit" name="Чистая прибыль" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.12} strokeWidth={2} />
                </AreaChart>
              </Chart>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Расходы по категориям" />
          <CardBody>
            {expenseData.length === 0 ? (
              <NoData />
            ) : (
              <Chart>
                <PieChart>
                  <Pie data={expenseData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                    {expenseData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </Chart>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Прибыльность товаров" description="Вклад товара после расходов на реализацию" />
          <CardBody>
            {productData.length === 0 ? (
              <NoData />
            ) : (
              <Chart>
                <BarChart data={productData} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
                  <XAxis type="number" tickFormatter={axisUzs} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="value" name="Прибыль" radius={4}>
                    {productData.map((x, i) => (
                      <Cell key={i} fill={x.value >= 0 ? 'var(--chart-2)' : 'var(--danger)'} />
                    ))}
                  </Bar>
                </BarChart>
              </Chart>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Сравнение партий" description="Вложено · вернулось выручкой · результат" />
          <CardBody>
            {batchData.length === 0 ? (
              <NoData text="Нет партий" />
            ) : (
              <Chart>
                <BarChart data={batchData}>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={axisUzs} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={72} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="invested" name="Вложено" fill="var(--chart-6)" radius={3} />
                  <Bar dataKey="recovered" name="Вернулось" fill="var(--chart-1)" radius={3} />
                  <Bar dataKey="profit" name="Результат" fill="var(--chart-2)" radius={3} />
                </BarChart>
              </Chart>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Структура себестоимости партий" />
          <CardBody>
            {costStructure.length === 0 ? (
              <NoData text="Нет партий" />
            ) : (
              <Chart>
                <PieChart>
                  <Pie data={costStructure} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                    {costStructure.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </Chart>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mb-4">
        <CardHeader title="Динамика остатков на складе" description="Стоимость запасов на конец дня" />
        <CardBody>
          {stockTimeline.length === 0 ? (
            <NoData text="За период не было движений склада" height={200} />
          ) : (
            <Chart height={200}>
              <AreaChart data={stockTimeline}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={axisUzs} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={72} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="stepAfter" dataKey="value" name="Стоимость запасов" stroke="var(--chart-4)" fill="var(--chart-4)" fillOpacity={0.14} strokeWidth={2} />
              </AreaChart>
            </Chart>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Последние операции" />
          <CardBody className="pt-2">
            {recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Операций пока нет</p>
            ) : (
              <ul className="divide-y text-sm">
                {recent.map((o) => (
                  <li key={o.key} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate">{o.title}</div>
                      <div className="text-xs text-muted-foreground">{o.kind} · {formatDate(o.date)}</div>
                    </div>
                    <span className={`num shrink-0 font-medium ${o.sign > 0 ? 'text-success' : ''}`}>{o.sign > 0 ? '+' : '−'}{formatUzs(o.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Проблемные товары" description="Низкий остаток или убыток на единицу" />
          <CardBody className="pt-2">
            {lowStock.length === 0 && losing.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Проблем не найдено</p>
            ) : (
              <ul className="divide-y text-sm">
                {lowStock.map((r) => (
                  <li key={`l${r.product.id}`} className="flex items-center justify-between gap-3 py-2">
                    <span className="truncate">{r.product.name}</span>
                    <Badge tone="warning">осталось {r.stock?.available} (мин. {r.product.min_stock})</Badge>
                  </li>
                ))}
                {losing.map((r) => (
                  <li key={`n${r.product.id}`} className="flex items-center justify-between gap-3 py-2">
                    <span className="truncate">{r.product.name}</span>
                    <span className="text-danger num">{formatUzs(r.unit!.profit)} / шт.</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Предстоящие платежи" action={<CalendarClock className="size-4 text-muted-foreground" />} />
          <CardBody className="pt-2">
            {upcoming.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Неоплаченных обязательств нет</p>
            ) : (
              <ul className="divide-y text-sm">
                {upcoming.map((u) => (
                  <li key={u.key} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate">{u.title}</div>
                      <div className={`text-xs ${u.overdue ? 'text-danger' : 'text-muted-foreground'}`}>{u.date ? `${u.overdue ? 'просрочено · ' : 'до '}${formatDate(u.date)}` : 'срок не указан'}</div>
                    </div>
                    <Money value={u.amount} className="shrink-0 font-medium" />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
              Кредиторская задолженность: <Money value={snap.payable} /> · дебиторская (ожидаемые выплаты Uzum): <Money value={snap.receivable} />
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  )
}

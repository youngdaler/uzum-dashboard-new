import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { axisNum, axisUzs, CHART_COLORS, Chart, ChartTooltip, NoData } from '@/components/charts'
import { PageHeader } from '@/components/common'
import { DataTable, type Column } from '@/components/data-table'
import { PeriodPicker, usePeriod } from '@/components/period-picker'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { useAppState, useDerived } from '@/data/store'
import { buildSeries, defaultGranularity, EXPENSE_GROUPS, expensesByGroup, productReport } from '@/lib/calc/finance'
import { buildProductRows } from '@/lib/productStats'
import { formatDate, formatNumber, formatUzs, todayIso } from '@/lib/format'

const pct = (v: number) => `${formatNumber(v, 1)}%`

interface TurnRow {
  id: string
  name: string
  stock: number
  perDay: number
  daysLeft: number | null
  value: number
}

export default function Analytics() {
  const { db } = useAppState()
  const d = useDerived()
  const range = usePeriod()
  const fin = d.finance
  const today = todayIso()
  const days = Math.max(1, Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86_400_000) + 1)

  const name = (id: string) => d.productsById.get(id)?.name ?? '—'
  const prod = useMemo(() => productReport(fin, range), [fin, range])

  const salesByProduct = prod
    .map((r) => ({ name: name(r.productId), units: r.units, revenue: r.revenue.toNumber() }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
  const marginByProduct = prod
    .filter((r) => r.marginPct !== null)
    .map((r) => ({ name: name(r.productId), margin: r.marginPct!.toNumber() }))
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 10)

  const returnsByProduct = useMemo(() => {
    const sold = new Map<string, number>()
    const ret = new Map<string, number>()
    for (const l of fin.lines.filter((x) => x.date >= range.from && x.date <= range.to)) sold.set(l.productId, (sold.get(l.productId) ?? 0) + l.qty)
    for (const r of fin.returns.filter((x) => x.date >= range.from && x.date <= range.to)) ret.set(r.productId, (ret.get(r.productId) ?? 0) + r.qty)
    return [...ret.entries()]
      .map(([id, q]) => ({ name: d.productsById.get(id)?.name ?? '—', rate: sold.get(id) ? (q / sold.get(id)!) * 100 : 0, qty: q }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 10)
  }, [fin, range, d.productsById])

  const expenseSeries = useMemo(() => {
    const pts = buildSeries(fin, range, defaultGranularity(range))
    return pts.map((p) => {
      const g = expensesByGroup(fin, p.range)
      const row: Record<string, number | string> = { label: p.label }
      for (const k of EXPENSE_GROUPS) row[k] = g[k].toNumber()
      return row
    })
  }, [fin, range])
  const usedGroups = EXPENSE_GROUPS.filter((k) => expenseSeries.some((r) => Number(r[k]) > 0))

  const rows = useMemo(() => buildProductRows(db, d, today), [db, d, today])
  const priceStructure = rows
    .filter((r) => r.unit && r.product.status === 'active')
    .map((r) => {
      const u = r.unit!
      return {
        name: r.product.name,
        'Себестоимость': u.unitCost.toNumber(),
        'Комиссия': u.commission.toNumber(),
        'Логистика Uzum и прочее': u.logistics.plus(u.otherDeductions).toNumber(),
        'Упаковка и доп.': u.variableCosts.toNumber(),
        'Прибыль': Math.max(u.profit.toNumber(), 0),
      }
    })
    .slice(0, 8)

  const turnover = useMemo<TurnRow[]>(() => {
    const soldByProduct = new Map<string, number>()
    for (const l of fin.lines.filter((x) => x.date >= range.from && x.date <= range.to)) soldByProduct.set(l.productId, (soldByProduct.get(l.productId) ?? 0) + l.qty)
    return db.products
      .filter((p) => p.status === 'active')
      .map((p) => {
        const s = d.inventory.byProduct.get(p.id)
        const perDay = (soldByProduct.get(p.id) ?? 0) / days
        return { id: p.id, name: p.name, stock: s?.available ?? 0, perDay, daysLeft: perDay > 0 ? Math.floor((s?.available ?? 0) / perDay) : null, value: s?.value.toNumber() ?? 0 }
      })
  }, [db.products, d, fin, range, days])

  const turnCols: Column<TurnRow>[] = [
    { key: 'n', header: 'Товар', sort: (r) => r.name, csv: (r) => r.name, cell: (r) => r.name },
    { key: 's', header: 'Доступно, шт.', align: 'right', sort: (r) => r.stock, csv: (r) => r.stock, cell: (r) => r.stock },
    { key: 'v', header: 'Стоимость остатка', align: 'right', sort: (r) => r.value, csv: (r) => r.value, cell: (r) => formatUzs(r.value) },
    { key: 'p', header: 'Продаж в день', align: 'right', sort: (r) => r.perDay, csv: (r) => Number(r.perDay.toFixed(2)), cell: (r) => formatNumber(r.perDay, 2) },
    { key: 'd', header: 'Запаса хватит на', align: 'right', sort: (r) => r.daysLeft, csv: (r) => r.daysLeft, cell: (r) => (r.daysLeft === null ? (r.stock > 0 ? 'нет продаж' : '—') : `${r.daysLeft} дн.`) },
  ]

  const rates = db.exchange_rates.filter((r) => r.pair === 'CNY_UZS').sort((a, b) => a.rate_date.localeCompare(b.rate_date)).map((r) => ({ date: formatDate(r.rate_date), rate: r.rate }))

  const noSales = salesByProduct.length === 0

  return (
    <>
      <PageHeader title="Аналитика" description="Где зарабатывает и теряет бизнес: товары, расходы, возвраты, оборачиваемость и курс." actions={<PeriodPicker />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Продажи по товарам" description="Выручка за период, топ-10" />
          <CardBody>
            {noSales ? <NoData /> : (
              <Chart>
                <BarChart data={salesByProduct} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
                  <XAxis type="number" tickFormatter={axisUzs} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="revenue" name="Выручка" fill="var(--chart-1)" radius={4} />
                </BarChart>
              </Chart>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Маржинальность товаров" description="Вклад / выручка, после расходов на реализацию" />
          <CardBody>
            {marginByProduct.length === 0 ? <NoData /> : (
              <Chart>
                <BarChart data={marginByProduct} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip format={(v) => pct(v)} />} />
                  <Bar dataKey="margin" name="Маржа" radius={4}>
                    {marginByProduct.map((x, i) => <Cell key={i} fill={x.margin >= 0 ? 'var(--chart-2)' : 'var(--danger)'} />)}
                  </Bar>
                </BarChart>
              </Chart>
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Динамика расходов по категориям" />
          <CardBody>
            {usedGroups.length === 0 ? <NoData /> : (
              <Chart>
                <BarChart data={expenseSeries}>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={axisUzs} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={72} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  {usedGroups.map((k, i) => <Bar key={k} dataKey={k} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </BarChart>
              </Chart>
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Куда уходит цена продажи" description="Структура цены единицы по текущей себестоимости (активные товары)" />
          <CardBody>
            {priceStructure.length === 0 ? <NoData text="Укажите цену продажи и себестоимость у товаров" /> : (
              <Chart height={300}>
                <BarChart data={priceStructure}>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
                  <YAxis tickFormatter={axisUzs} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={72} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Себестоимость" stackId="p" fill="var(--chart-6)" />
                  <Bar dataKey="Комиссия" stackId="p" fill="var(--chart-3)" />
                  <Bar dataKey="Логистика Uzum и прочее" stackId="p" fill="var(--chart-4)" />
                  <Bar dataKey="Упаковка и доп." stackId="p" fill="var(--chart-5)" />
                  <Bar dataKey="Прибыль" stackId="p" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </Chart>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Доля возвратов по товарам" description="Возвращённые шт. / проданные шт. за период" />
          <CardBody>
            {returnsByProduct.length === 0 ? <NoData text="Возвратов за период не было" /> : (
              <Chart>
                <BarChart data={returnsByProduct} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip format={(v) => pct(v)} />} />
                  <Bar dataKey="rate" name="Доля возвратов" fill="var(--chart-3)" radius={4} />
                </BarChart>
              </Chart>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Курс CNY/UZS" description="История введённых курсов (Настройки → Курсы)" />
          <CardBody>
            {rates.length < 2 ? <NoData text="Нужно минимум два значения курса" /> : (
              <Chart>
                <LineChart data={rates}>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis domain={['auto', 'auto']} tickFormatter={axisNum} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={72} />
                  <Tooltip content={<ChartTooltip format={(v) => formatNumber(v, 2)} />} />
                  <Line type="monotone" dataKey="rate" name="CNY/UZS" stroke="var(--chart-1)" strokeWidth={2} dot />
                </LineChart>
              </Chart>
            )}
          </CardBody>
        </Card>
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold">Оборачиваемость и запас в днях</h2>
      <DataTable rows={turnover} columns={turnCols} rowKey={(r) => r.id} searchText={(r) => r.name} defaultSort={{ key: 'd', dir: 'asc' }} exportName="oborachivaemost" empty="Нет активных товаров." />
      <p className="mt-2 text-xs text-muted-foreground">Скорость продаж считается за выбранный период ({days} дн.); при коротком периоде оценка менее надёжна.</p>
    </>
  )
}

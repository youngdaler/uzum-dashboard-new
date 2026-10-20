import { RotateCcw } from 'lucide-react'
import BatchCalculator from './calculator-batch'
import { Segmented } from '@/components/ui/tabs'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { KeyValue, Money, Notice, PageHeader, Pct } from '@/components/common'
import { useAppState } from '@/data/store'
import { calculate, DEFAULT_CALCULATOR, rateVsPriceGrid, reversePrice, sensitivity, type CalculatorInput, type ReverseMode } from '@/lib/calc/calculator'
import { feeFor } from '@/lib/calc/derive'
import { formatNumber, formatUzs, todayIso } from '@/lib/format'
import { latestRateOf } from '@/lib/productStats'
import { cn } from '@/lib/utils'
import { kgToG, gToKg } from '@/lib/weight'

const STORAGE = 'uzum-calculator'

function NumField({ label, value, onChange, step, suffix, hint }: { label: string; value: number; onChange: (n: number) => void; step?: string; suffix?: string; hint?: string }) {
  // Keep the user's text while editing: converting 0. or 0.10 to a number
  // on every keystroke makes decimal prices impossible to enter naturally.
  const [draft, setDraft] = useState(() => value === 0 ? '' : String(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(value === 0 ? '' : String(value))
  }, [value, focused])

  const change = (raw: string) => {
    const next = raw.replace(',', '.')
    if (!/^(?:\d+(?:\.\d*)?|\.\d*)?$/.test(next)) return
    setDraft(next)
    if (next === '' || next === '.') {
      onChange(0)
    } else {
      const parsed = Number(next)
      if (Number.isFinite(parsed)) onChange(parsed)
    }
  }

  return (
    <div>
      <Label>{label}</Label>
      <div className="relative">
        <Input
          type="text"
          inputMode={step === '1' ? 'numeric' : 'decimal'}
          value={draft}
          placeholder="0"
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            setDraft(value === 0 ? '' : String(value))
          }}
          onChange={(e) => change(e.target.value)}
          className={suffix ? 'pr-12' : ''}
        />
        {suffix && <span className="pointer-events-none absolute right-3 top-2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="grid gap-3 sm:grid-cols-2">{children}</CardBody>
    </Card>
  )
}

function loadSaved(): CalculatorInput | null {
  try {
    const raw = localStorage.getItem(STORAGE)
    return raw ? ({ ...DEFAULT_CALCULATOR, ...(JSON.parse(raw) as Partial<CalculatorInput>) }) : null
  } catch {
    return null
  }
}

const DELTAS = [-20, -10, -5, 0, 5, 10, 20]
const GRID = [-10, -5, 0, 5, 10]

export default function CalculatorPage() {
  const { db } = useAppState()
  const defaults = useMemo<CalculatorInput>(() => {
    const fee = feeFor(db, null, todayIso())
    return {
      ...DEFAULT_CALCULATOR,
      cnyRate: latestRateOf(db, 'CNY_UZS') ?? 0,
      usdRate: latestRateOf(db, 'USD_UZS') ?? 0,
      commissionPct: fee?.commission_pct ?? 0,
      logisticsPerUnit: (fee?.logistics_fee_uzs ?? 0) + (fee?.processing_fee_uzs ?? 0),
    }
  }, [db])

  const [input, setInput] = useState<CalculatorInput>(() => loadSaved() ?? defaults)
  const [reverseMode, setReverseMode] = useState<ReverseMode>('margin')
  const [reverseTarget, setReverseTarget] = useState(25)
  const [productId, setProductId] = useState('')
  const [calculatorView, setCalculatorView] = useState<'unit' | 'batch'>('unit')

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(input))
    } catch {
      /* введённые значения просто не запомнятся */
    }
  }, [input])

  const set = <K extends keyof CalculatorInput>(k: K, v: CalculatorInput[K]) => setInput((s) => ({ ...s, [k]: v }))
  const r = useMemo(() => calculate(input), [input])
  const reversed = useMemo(() => reversePrice(input, reverseMode, reverseTarget), [input, reverseMode, reverseTarget])
  const sens = useMemo(
    () => ({
      rate: sensitivity(input, 'rate', DELTAS),
      cargo: sensitivity(input, 'cargo', DELTAS),
      price: sensitivity(input, 'price', DELTAS),
    }),
    [input],
  )
  const grid = useMemo(() => rateVsPriceGrid(input, GRID, GRID), [input])

  const fromProduct = (id: string) => {
    setProductId(id)
    const p = db.products.find((x) => x.id === id)
    if (!p) return
    const fee = feeFor(db, p.category_id, todayIso())
    setInput((s) => ({
      ...s,
      purchasePriceCny: p.purchase_price_cny,
      unitWeightKg: p.weight_kg,
      plannedPrice: p.sale_price_uzs,
      commissionPct: p.commission_pct ?? fee?.commission_pct ?? s.commissionPct,
      logisticsPerUnit: fee ? fee.logistics_fee_uzs + fee.processing_fee_uzs : s.logisticsPerUnit,
      packagingPerUnit: p.packaging_cost_uzs,
      otherPerUnit: p.extra_cost_uzs,
    }))
  }

  const cargoMissing = input.unitWeightKg > 0 && input.cargoRate === 0
  const rateMissing = input.cnyRate === 0

  return (
    <>
      <PageHeader
        title="Калькулятор себестоимости и прибыли"
        description="Введите условия закупки и продажи — результат пересчитывается мгновенно. Значения сохраняются в браузере."
        actions={
          <>
            <Select aria-label="Подставить из товара" value={productId} onChange={(e) => fromProduct(e.target.value)} className="w-52">
              <option value="">Подставить из товара…</option>
              {db.products.filter((p) => p.status === 'active').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Button variant="outline" onClick={() => { setInput(defaults); setProductId('') }}>
              <RotateCcw /> Сбросить
            </Button>
          </>
        }
      />

      <div className="mb-4"><Segmented value={calculatorView} onChange={setCalculatorView} options={[{ value: 'unit', label: 'За единицу' }, { value: 'batch', label: 'За партию' }]} /></div>
      {calculatorView === 'batch' ? <BatchCalculator /> : <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="space-y-4">
          <Section title="Закупка">
            <NumField label="Закупочная цена, CNY" value={input.purchasePriceCny} onChange={(n) => set('purchasePriceCny', n)} suffix="¥" />
            <NumField label="Количество, шт." value={input.qty} onChange={(n) => set('qty', Math.floor(n))} step="1" />
            <NumField label="Курс CNY/UZS" value={input.cnyRate} onChange={(n) => set('cnyRate', n)} hint={rateMissing ? 'Укажите курс или задайте его в настройках' : undefined} />
            <NumField label="Курс USD/UZS" value={input.usdRate} onChange={(n) => set('usdRate', n)} hint="Нужен, если карго считается в долларах" />
          </Section>
          <Section title="Доставка и расходы партии">
            <NumField label="Вес одной единицы, г" value={kgToG(input.unitWeightKg)} onChange={(n) => set('unitWeightKg', gToKg(n))} />
            <div className="grid grid-cols-[1fr_88px] gap-2">
              <NumField label="Карго за кг" value={input.cargoRate} onChange={(n) => set('cargoRate', n)} />
              <div>
                <Label>Валюта</Label>
                <Select value={input.cargoCurrency} onChange={(e) => set('cargoCurrency', e.target.value as CalculatorInput['cargoCurrency'])}>
                  <option value="USD">USD</option>
                  <option value="CNY">CNY</option>
                  <option value="UZS">UZS</option>
                </Select>
              </div>
            </div>
            <NumField label="Доп. расходы на всю партию, UZS" value={input.extraBatchCostsUzs} onChange={(n) => set('extraBatchCostsUzs', n)} hint="Таможня, посредник, брокер, доставка по Узбекистану…" />
          </Section>
          <Section title="Продажа на Uzum">
            <NumField label="Плановая цена продажи, UZS" value={input.plannedPrice} onChange={(n) => set('plannedPrice', n)} />
            <NumField label="Скидка продавца, UZS" value={input.sellerDiscount} onChange={(n) => set('sellerDiscount', n)} />
            <NumField label="Комиссия Uzum, %" value={input.commissionPct} onChange={(n) => set('commissionPct', Math.min(n, 100))} suffix="%" hint="Проверьте актуальный тариф для вашей категории" />
            <NumField label="Логистика и обработка заказа, UZS/шт." value={input.logisticsPerUnit} onChange={(n) => set('logisticsPerUnit', n)} />
            <NumField label="Упаковка, UZS/шт." value={input.packagingPerUnit} onChange={(n) => set('packagingPerUnit', n)} />
            <NumField label="Прочие расходы, UZS/шт." value={input.otherPerUnit} onChange={(n) => set('otherPerUnit', n)} />
            <div className="grid grid-cols-[1fr_150px] gap-2 sm:col-span-2">
              <NumField label="Реклама, UZS" value={input.adsAmount} onChange={(n) => set('adsAmount', n)} />
              <div>
                <Label>Считать</Label>
                <Select value={input.adsMode} onChange={(e) => set('adsMode', e.target.value as CalculatorInput['adsMode'])}>
                  <option value="per_sale">на 1 продажу</option>
                  <option value="per_batch">на партию</option>
                </Select>
              </div>
            </div>
          </Section>
        </div>

        <div className="space-y-4 lg:sticky lg:top-16 lg:self-start">
          {!r.valid && <Notice tone="warning">Заполните цену закупки, количество и курс CNY/UZS — тогда расчёт станет полным.</Notice>}
          {cargoMissing && <Notice tone="warning">Указан вес, но не указан тариф карго — доставка учтена как 0.</Notice>}
          <Card>
            <CardHeader title="Себестоимость" />
            <CardBody>
              <KeyValue
                rows={[
                  { label: 'Закупка, 1 шт.', value: <Money value={r.purchasePerUnit} /> },
                  { label: 'Доставка (карго), 1 шт.', value: <Money value={r.cargoPerUnit} /> },
                  { label: 'Доп. расходы партии, 1 шт.', value: <Money value={r.extraPerUnit} /> },
                  { label: 'Полная себестоимость, 1 шт.', value: <Money value={r.unitCost} />, strong: true, border: true },
                  { label: 'Товары (партия)', value: <Money value={r.goodsTotal} />, border: true },
                  { label: 'Карго (партия)', value: <Money value={r.cargoTotal} /> },
                  { label: 'Доп. расходы (партия)', value: <Money value={r.extraTotal} /> },
                  { label: 'Расходы на всю партию', value: <Money value={r.totalCost.plus(r.batchAds)} />, strong: true },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Прибыль" description="Прибыль на единицу = чистая выплата − себестоимость − переменные расходы" />
            <CardBody>
              <KeyValue
                rows={[
                  { label: 'Выручка с единицы (цена − скидка)', value: <Money value={r.revenuePerUnit} /> },
                  { label: 'Комиссия Uzum', value: <Money value={r.commissionPerUnit} />, indent: true },
                  { label: 'Чистая выплата', value: <Money value={r.payoutPerUnit} /> },
                  { label: 'Прибыль с 1 проданной единицы', value: <Money value={r.profitPerUnit} signed />, strong: true, border: true },
                  { label: 'Маржинальность', value: <Pct value={r.marginPct} /> },
                  { label: 'Наценка', value: <Pct value={r.markupPct} /> },
                  { label: 'ROI', value: <Pct value={r.roiPct} /> },
                  {
                    label: 'Точка безубыточности',
                    value: r.breakEvenUnits === null ? <span className="text-danger">не окупится</span> : `${formatNumber(r.breakEvenUnits)} шт.${r.breakEvenPct ? ` (${formatNumber(r.breakEvenPct, 0)}% партии)` : ''}`,
                  },
                ]}
              />
              {r.breakEvenUnits === null && r.valid && <Notice tone="danger" className="mt-2 text-xs">Вклад на единицу не положителен: при такой цене и расходах каждая продажа увеличивает убыток.</Notice>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Прибыль при продаже части партии" />
            <CardBody>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-1 font-medium">Доля</th>
                    <th className="pb-1 text-right font-medium">Шт.</th>
                    <th className="pb-1 text-right font-medium">Выручка</th>
                    <th className="pb-1 text-right font-medium">Прибыль</th>
                  </tr>
                </thead>
                <tbody>
                  {r.scenarios.map((s) => (
                    <tr key={s.pct} className="border-t">
                      <td className="py-1.5">{s.pct}%</td>
                      <td className="num py-1.5 text-right">{s.unitsSold}</td>
                      <td className="py-1.5 text-right"><Money value={s.revenue} /></td>
                      <td className="py-1.5 text-right"><Money value={s.profit} signed /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">Прибыль = вклад проданных единиц − полные расходы на партию (включая нераспроданный остаток).</p>
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Обратный расчёт цены" description="Какая цена нужна, чтобы получить желаемый результат" />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Цель</Label>
                <Select value={reverseMode} onChange={(e) => { setReverseMode(e.target.value as ReverseMode); setReverseTarget(e.target.value === 'margin' ? 25 : 30000) }}>
                  <option value="margin">Маржинальность, %</option>
                  <option value="profit">Прибыль с единицы, UZS</option>
                </Select>
              </div>
              <NumField label={reverseMode === 'margin' ? 'Желаемая маржа, %' : 'Желаемая прибыль, UZS'} value={reverseTarget} onChange={setReverseTarget} />
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              {reversed === null ? (
                <p className="text-sm text-danger">Цель недостижима: комиссия и целевая маржа вместе превышают 100% выручки.</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">Необходимая цена продажи</p>
                  <p className="num text-xl font-semibold">{formatUzs(reversed)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Сейчас: {input.plannedPrice > 0 ? formatUzs(input.plannedPrice) : 'не задана'}
                    {input.plannedPrice > 0 && ` (${reversed.gt(input.plannedPrice) ? '+' : ''}${formatNumber(reversed.minus(input.plannedPrice).div(input.plannedPrice).mul(100), 1)}%)`}
                  </p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => set('plannedPrice', reversed.toNumber())}>
                    Применить как плановую цену
                  </Button>
                </>
              )}
            </div>
            {reversed !== null && !r.valid && <p className="text-xs text-muted-foreground">Расчёт точнее после заполнения данных о закупке.</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Сценарии: курс, карго, цена" description="Как изменится прибыль при отклонении параметра" />
          <CardBody>
            <Tabs defaultValue="rate">
              <TabsList>
                <TabsTrigger value="rate">Курс валют</TabsTrigger>
                <TabsTrigger value="cargo">Тариф карго</TabsTrigger>
                <TabsTrigger value="price">Цена продажи</TabsTrigger>
                <TabsTrigger value="grid">Курс × цена</TabsTrigger>
              </TabsList>
              {(['rate', 'cargo', 'price'] as const).map((k) => (
                <TabsContent key={k} value={k}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="pb-1 font-medium">Изменение</th>
                        <th className="pb-1 text-right font-medium">Прибыль/шт.</th>
                        <th className="pb-1 text-right font-medium">Маржа</th>
                        <th className="pb-1 text-right font-medium">Вся партия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sens[k].map((s) => (
                        <tr key={s.deltaPct} className={cn('border-t', s.deltaPct === 0 && 'bg-muted/50 font-medium')}>
                          <td className="py-1.5">{s.deltaPct > 0 ? '+' : ''}{s.deltaPct}%</td>
                          <td className="py-1.5 text-right"><Money value={s.profitPerUnit} signed /></td>
                          <td className="py-1.5 text-right"><Pct value={s.marginPct} /></td>
                          <td className="py-1.5 text-right"><Money value={s.batchProfit} signed /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TabsContent>
              ))}
              <TabsContent value="grid">
                <p className="mb-2 text-xs text-muted-foreground">Прибыль всей партии при продаже 100%: строки — изменение курса, столбцы — изменение цены продажи.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th className="pb-1 text-left font-medium text-muted-foreground">Курс \ Цена</th>
                        {GRID.map((g) => (
                          <th key={g} className="pb-1 text-right font-medium text-muted-foreground">{g > 0 ? '+' : ''}{g}%</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {grid.map((row, i) => (
                        <tr key={GRID[i]} className="border-t">
                          <td className="py-1.5 text-muted-foreground">{GRID[i] > 0 ? '+' : ''}{GRID[i]}%</td>
                          {row.map((v, j) => (
                            <td key={j} className={cn('num py-1.5 text-right', v.isNegative() ? 'text-danger' : 'text-success', GRID[i] === 0 && GRID[j] === 0 && 'font-semibold')}>
                              {formatUzs(v, false)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            </Tabs>
          </CardBody>
        </Card>
      </div>
      </>}
    </>
  )
}

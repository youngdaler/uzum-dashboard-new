import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/form'
import { Notice } from '@/components/common'
import { formatUzs } from '@/lib/format'
import { useAppState } from '@/data/store'
import { latestRateOf } from '@/lib/productStats'

const KEY = 'uzum-batch-calculation-draft-v1'
type Allocation = 'weight' | 'value' | 'quantity'
type Row = { id: string; name: string; qty: string; unitsPerPack: string; cny: string; grams: string; price: string; commission: string; logistics: string; packaging: string }
type Draft = { rows: Row[]; cnyRate: string; usdRate: string; cargoKg: string; cargoCurrency: 'USD'|'CNY'|'UZS'; other: string; ads: string; allocation: Allocation }
const newRow = (): Row => ({ id: crypto.randomUUID(), name: '', qty: '100', unitsPerPack: '1', cny: '0.10', grams: '100', price: '5000', commission: '15', logistics: '500', packaging: '100' })
const initial = (): Draft => ({ rows: [newRow()], cnyRate: '', usdRate: '', cargoKg: '5', cargoCurrency: 'USD', other: '0', ads: '0', allocation: 'weight' })
function saved(): Draft {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return initial()
    const parsed = JSON.parse(raw) as Partial<Draft>
    const base = initial()
    return { ...base, ...parsed, rows: Array.isArray(parsed.rows) && parsed.rows.length ? parsed.rows : base.rows }
  } catch { return initial() }
}
const numeric = (s: string) => Math.max(0, Number(s.replace(',', '.')) || 0)
function Decimal({ value, onChange, label }: {value: string; onChange: (s: string) => void; label: string}) {
  return <div className="min-w-0"><Label>{label}</Label><Input aria-label={label} type="text" inputMode="decimal" value={value} onChange={e => {
    const v = e.target.value.replace(',', '.')
    if (/^(?:\d+(?:\.\d*)?|\.\d*)?$/.test(v)) onChange(v)
  }} /></div>
}
const fmt = (n: number) => formatUzs(Number.isFinite(n) ? n : 0)
export default function BatchCalculator() {
  const { db } = useAppState()
  const [draft, setDraft] = useState<Draft>(saved)
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(s => ({ ...s, [key]: value }))
  const updateRow = (id: string, key: keyof Row, value: string) => setDraft(s => ({ ...s, rows: s.rows.map(r => r.id === id ? { ...r, [key]: value } : r) }))
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(draft)) } catch { /* no storage */ } }, [draft])
  const recommendedCny = latestRateOf(db, 'CNY_UZS') ?? 0
  const recommendedUsd = latestRateOf(db, 'USD_UZS') ?? 0
  const result = useMemo(() => {
    const cnyRate = numeric(draft.cnyRate || String(recommendedCny))
    const usdRate = numeric(draft.usdRate || String(recommendedUsd))
    const lines = draft.rows.map(row => {
      const qty = Math.floor(numeric(row.qty))
      const piecesPerPack = Math.max(1, Math.floor(numeric(row.unitsPerPack || '1')))
      const packs = Math.floor(qty / piecesPerPack)
      const remainder = qty % piecesPerPack
      const goods = qty * numeric(row.cny) * cnyRate
      const weight = qty * numeric(row.grams) / 1000
      return { ...row, units: qty, piecesPerPack, packs, remainder, goods, weight, revenue: packs * numeric(row.price) }
    })
    const goodsTotal = lines.reduce((s, r) => s + r.goods, 0)
    const totalWeight = lines.reduce((s, r) => s + r.weight, 0)
    const count = lines.reduce((s, r) => s + r.units, 0)
    const packCount = lines.reduce((s, r) => s + r.packs, 0)
    const cargoRate = draft.cargoCurrency === 'USD' ? usdRate : draft.cargoCurrency === 'CNY' ? cnyRate : 1
    const cargoTotal = totalWeight * numeric(draft.cargoKg) * cargoRate
    const shared = numeric(draft.other) + numeric(draft.ads)
    const totalWeighting = draft.allocation === 'weight' ? totalWeight : draft.allocation === 'value' ? goodsTotal : count
    const details = lines.map(line => {
      const basis = draft.allocation === 'weight' ? line.weight : draft.allocation === 'value' ? line.goods : line.units
      const share = totalWeighting ? basis / totalWeighting : (lines.length ? 1 / lines.length : 0)
      const sharedCost = (cargoTotal + shared) * share
      const directCost = line.goods + line.packs * numeric(line.packaging)
      const commission = line.revenue * Math.min(100, numeric(line.commission)) / 100
      const logistics = line.packs * numeric(line.logistics)
      const investment = directCost + sharedCost
      const profit = line.revenue - investment - commission - logistics
      const netPerPack = line.packs ? profit / line.packs : 0
      const breakEven = line.packs && numeric(line.commission) < 100
        ? (investment / line.packs + numeric(line.logistics)) / (1 - numeric(line.commission) / 100) : null
      return { ...line, sharedCost, investment, commission, logistics, profit, netPerPack, breakEven, unitCost: line.packs ? investment / line.packs : 0 }
    })
    return { details, totalWeight, count, packCount, goodsTotal, cargoTotal, shared, investment: details.reduce((s,r) => s + r.investment,0), revenue: details.reduce((s,r) => s+r.revenue,0), commission: details.reduce((s,r) => s+r.commission,0), logistics: details.reduce((s,r) => s+r.logistics,0), profit: details.reduce((s,r) => s+r.profit,0), valid: cnyRate > 0 && count > 0 }
  }, [draft, recommendedCny, recommendedUsd])
  return <div className="space-y-4">
    <Notice tone="primary">Черновик расчёта автоматически сохраняется только в этом браузере. Он пока не синхронизируется с Supabase и не создаёт складскую партию.</Notice>
    <Card><CardHeader title="Товары в партии" description="Добавь любое количество разных товаров. Введи число закупленных штук и сколько штук продаётся в одной упаковке на Uzum. Цены закупки поддерживают дроби, например 0.10 CNY." action={<Button size="sm" onClick={() => update('rows', [...draft.rows, newRow()])}><Plus className="size-4" /> Добавить товар</Button>} />
      <CardBody className="space-y-4">
        {draft.rows.map((row, i) => <div key={row.id} className="rounded-lg border p-3 space-y-3">
          <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">Товар {i+1}</p><Button size="sm" variant="outline" disabled={draft.rows.length === 1} onClick={() => update('rows', draft.rows.filter(r => r.id !== row.id))}><Trash2 className="size-4" /> Удалить</Button></div>
          <div><Label>Название товара</Label><Input value={row.name} placeholder="Например, адаптер USB-C" onChange={e => updateRow(row.id, 'name', e.target.value)} /></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Decimal label="Закуплено, шт." value={row.qty} onChange={v => updateRow(row.id,'qty',v)} />
            <Decimal label="Шт. в одной упаковке" value={row.unitsPerPack || '1'} onChange={v => updateRow(row.id,'unitsPerPack',v)} />
            <Decimal label="Закупка, CNY/шт." value={row.cny} onChange={v => updateRow(row.id,'cny',v)} />
            <Decimal label="Вес, г/шт." value={row.grams} onChange={v => updateRow(row.id,'grams',v)} />
            <Decimal label="Цена продажи, UZS/уп." value={row.price} onChange={v => updateRow(row.id,'price',v)} />
            <Decimal label="Комиссия Uzum, %" value={row.commission} onChange={v => updateRow(row.id,'commission',v)} />
            <Decimal label="Логистика Uzum, UZS/уп." value={row.logistics} onChange={v => updateRow(row.id,'logistics',v)} />
            <Decimal label="Стоимость упаковки, UZS/уп." value={row.packaging} onChange={v => updateRow(row.id,'packaging',v)} />
          </div>
          <p className="text-xs text-muted-foreground">Для продажи на Uzum: {Math.floor(numeric(row.qty) / Math.max(1, Math.floor(numeric(row.unitsPerPack || '1'))))} полных упаковок по {Math.max(1, Math.floor(numeric(row.unitsPerPack || '1')))} шт.{Math.floor(numeric(row.qty)) % Math.max(1, Math.floor(numeric(row.unitsPerPack || '1'))) > 0 ? `, остаток ${Math.floor(numeric(row.qty)) % Math.max(1, Math.floor(numeric(row.unitsPerPack || '1')))} шт. без полной упаковки` : ''}. Цена и расходы Uzum считаются за упаковку.</p>
        </div>)}
      </CardBody>
    </Card>
    <Card><CardHeader title="Курс валют, карго и общие расходы" /><CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Decimal label="Курс CNY → UZS" value={draft.cnyRate} onChange={v => update('cnyRate',v)} />
      <Decimal label="Курс USD → UZS" value={draft.usdRate} onChange={v => update('usdRate',v)} />
      <Decimal label="Тариф карго за кг" value={draft.cargoKg} onChange={v => update('cargoKg',v)} />
      <div><Label>Валюта карго</Label><Select value={draft.cargoCurrency} onChange={e => update('cargoCurrency',e.target.value as Draft['cargoCurrency'])}><option>USD</option><option>CNY</option><option>UZS</option></Select></div>
      <Decimal label="Доп. расходы партии, UZS" value={draft.other} onChange={v => update('other',v)} />
      <Decimal label="Реклама на всю партию, UZS" value={draft.ads} onChange={v => update('ads',v)} />
      <div className="sm:col-span-2 lg:col-span-3"><Label>Распределить общие расходы по</Label><Select value={draft.allocation} onChange={e => update('allocation',e.target.value as Allocation)}><option value="weight">Весу товаров</option><option value="value">Закупочной стоимости</option><option value="quantity">Количеству единиц</option></Select></div>
      <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">Если оставить курс пустым, используется последний курс из настроек: CNY {recommendedCny || '—'}, USD {recommendedUsd || '—'}. Карго и общие расходы распределяются по выбранной базе.</p>
    </CardBody></Card>
    {!result.valid && <Notice tone="warning">Укажи курс CNY/UZS и количество товаров, чтобы получить полноценный расчёт. Для карго в USD также нужен курс USD/UZS.</Notice>}
    <Notice tone="primary">Учитываются все закупленные единицы и их вес. Выручка рассчитывается только по полным упаковкам. Неполные упаковки остаются в остатке, а их закупочная стоимость включена в затраты партии.</Notice>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[['Общие вложения',result.investment],['Ожидаемая выручка',result.revenue],['Прибыль при продаже 100%',result.profit],['Карго за всю партию',result.cargoTotal]].map(([title,value]) => <Card key={String(title)}><CardBody><p className="text-xs text-muted-foreground">{title}</p><p className="mt-1 text-lg font-semibold">{fmt(Number(value))}</p></CardBody></Card>)}
    </div>
    <Card><CardHeader title="Итоги по каждому товару" description="Прогноз продажи всех полных упаковок. Неполные упаковки остаются остатком. Налоги и возвраты добавляй в дополнительные расходы." /><CardBody>
      <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-2">Товар</th><th className="pb-2 text-right">Шт.</th><th className="pb-2 text-right">Шт./уп.</th><th className="pb-2 text-right">Упаковок</th><th className="pb-2 text-right">Остаток, шт.</th><th className="pb-2 text-right">Себест./уп.</th><th className="pb-2 text-right">Цена</th><th className="pb-2 text-right">Прибыль/уп.</th><th className="pb-2 text-right">Прибыль товара</th><th className="pb-2 text-right">Безубыт./уп.</th></tr></thead><tbody>{result.details.map((line,i) => <tr key={line.id} className="border-t"><td className="py-2">{line.name || `Товар ${i+1}`}</td><td className="text-right">{line.units}</td><td className="text-right">{line.piecesPerPack}</td><td className="text-right">{line.packs}</td><td className="text-right">{line.remainder}</td><td className="text-right">{line.packs ? fmt(line.unitCost) : '—'}</td><td className="text-right">{fmt(numeric(line.price))}</td><td className={`text-right ${line.netPerPack < 0 ? 'text-danger' : 'text-success'}`}>{line.packs ? fmt(line.netPerPack) : '—'}</td><td className={`text-right ${line.profit < 0 ? 'text-danger' : 'text-success'}`}>{fmt(line.profit)}</td><td className="text-right">{line.breakEven === null ? '—' : fmt(line.breakEven)}</td></tr>)}</tbody></table></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm"><p>Закуплено: <b>{result.count} шт.</b></p><p>Для Uzum: <b>{result.packCount} упаковок</b></p><p>Вес: <b>{result.totalWeight.toFixed(2)} кг</b></p><p>Закупка: <b>{fmt(result.goodsTotal)}</b></p><p>Комиссии Uzum: <b>{fmt(result.commission)}</b></p><p>Логистика: <b>{fmt(result.logistics)}</b></p><p>ROI по вложениям: <b>{result.investment > 0 ? (100*result.profit/result.investment).toFixed(1) : '0'}%</b></p></div>
    </CardBody></Card>
    <div className="flex justify-end"><Button variant="outline" onClick={() => { if(window.confirm('Сбросить расчёт партии?')) setDraft(initial()) }}><RotateCcw className="size-4" /> Сбросить калькуляцию</Button></div>
  </div>
}

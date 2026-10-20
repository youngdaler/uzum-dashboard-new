import { getState, insertRows } from '@/data/store'
import { parseCsv, parseDate, parseNum } from '@/lib/export'
import { saveExpense } from '@/data/actions'
import { rateFor } from '@/data/actions'
import { todayIso } from '@/lib/format'
import type { Currency, Product } from '@/types/db'
import { gToKg } from '@/lib/weight'

export interface ImportResult {
  created: number
  skipped: number
  messages: string[]
}

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е')

/** Индексы колонок по набору допустимых названий заголовка. */
function headerIndex(header: string[], names: Record<string, string[]>): Record<string, number> {
  const h = header.map(norm)
  const out: Record<string, number> = {}
  for (const [key, aliases] of Object.entries(names)) {
    out[key] = h.findIndex((x) => aliases.map(norm).includes(x))
  }
  return out
}

export const PRODUCT_CSV_HEADERS = ['Название', 'Артикул', 'Штрихкод', 'Категория', 'Поставщик', 'Цена закупки CNY', 'Цена продажи UZS', 'Вес г', 'Мин. остаток']
export const EXPENSE_CSV_HEADERS = ['Дата', 'Категория', 'Сумма', 'Валюта', 'Курс', 'Партия', 'Комментарий']

export async function importProductsCsv(text: string): Promise<ImportResult> {
  const rows = parseCsv(text)
  if (rows.length < 2) throw new Error('В файле нет данных: нужна строка заголовков и хотя бы одна строка товара.')
  const idx = headerIndex(rows[0], {
    name: ['Название', 'name'],
    sku: ['Артикул', 'sku', 'SKU'],
    barcode: ['Штрихкод', 'barcode'],
    category: ['Категория', 'category'],
    supplier: ['Поставщик', 'supplier'],
    price: ['Цена закупки CNY', 'Цена закупки', 'cny'],
    sale: ['Цена продажи UZS', 'Цена продажи', 'price'],
    weight: ['Вес г', 'Вес', 'weight'],
    min: ['Мин. остаток', 'Минимальный остаток', 'min'],
  })
  if (idx.name < 0 || idx.sku < 0) throw new Error('В файле должны быть колонки «Название» и «Артикул».')
  const db = getState().db
  const cats = new Map(db.categories.filter((c) => c.kind === 'product').map((c) => [norm(c.name), c.id]))
  const sups = new Map(db.suppliers.map((s) => [norm(s.name), s.id]))
  const existing = new Set(db.products.map((p) => norm(p.sku)))
  const defMin = db.profile?.default_min_stock ?? 0

  const res: ImportResult = { created: 0, skipped: 0, messages: [] }
  const toInsert: Partial<Product>[] = []
  rows.slice(1).forEach((r, i) => {
    const line = i + 2
    const name = r[idx.name]?.trim()
    const sku = r[idx.sku]?.trim()
    if (!name || !sku) {
      res.skipped++
      res.messages.push(`Строка ${line}: пропущена — не заполнены название или артикул.`)
      return
    }
    if (existing.has(norm(sku))) {
      res.skipped++
      res.messages.push(`Строка ${line}: артикул «${sku}» уже существует.`)
      return
    }
    existing.add(norm(sku))
    const cat = idx.category >= 0 ? r[idx.category] : ''
    const sup = idx.supplier >= 0 ? r[idx.supplier] : ''
    if (cat && !cats.has(norm(cat))) res.messages.push(`Строка ${line}: категория «${cat}» не найдена — оставлена пустой.`)
    if (sup && !sups.has(norm(sup))) res.messages.push(`Строка ${line}: поставщик «${sup}» не найден — оставлен пустым.`)
    const sale = parseNum(r[idx.sale]) ?? 0
    toInsert.push({
      name,
      sku,
      barcode: (idx.barcode >= 0 ? r[idx.barcode]?.trim() : '') || null,
      category_id: cats.get(norm(cat ?? '')) ?? null,
      photo_url: null,
      source_url: null,
      supplier_id: sups.get(norm(sup ?? '')) ?? null,
      purchase_price_cny: parseNum(r[idx.price]) ?? 0,
      recommended_price_uzs: sale,
      sale_price_uzs: sale,
      commission_pct: null,
      packaging_cost_uzs: 0,
      extra_cost_uzs: 0,
      weight_kg: gToKg(parseNum(r[idx.weight]) ?? 0),
      volume_m3: 0,
      min_stock: parseNum(r[idx.min]) ?? defMin,
      expected_monthly_sales: null,
      status: 'active',
      is_demo: false,
    })
  })
  if (toInsert.length) await insertRows<Product>('products', toInsert)
  res.created = toInsert.length
  return res
}

export async function importExpensesCsv(text: string): Promise<ImportResult> {
  const rows = parseCsv(text)
  if (rows.length < 2) throw new Error('В файле нет данных: нужна строка заголовков и хотя бы одна строка расхода.')
  const idx = headerIndex(rows[0], {
    date: ['Дата', 'date'],
    category: ['Категория', 'category'],
    amount: ['Сумма', 'amount'],
    currency: ['Валюта', 'currency'],
    rate: ['Курс', 'rate'],
    batch: ['Партия', 'batch'],
    comment: ['Комментарий', 'comment'],
  })
  if (idx.category < 0 || idx.amount < 0) throw new Error('В файле должны быть колонки «Категория» и «Сумма».')
  const db = getState().db
  const cats = new Map(db.categories.filter((c) => c.kind === 'expense').map((c) => [norm(c.name), c]))
  const batches = new Map(db.purchase_batches.map((b) => [norm(b.batch_no), b.id]))

  const res: ImportResult = { created: 0, skipped: 0, messages: [] }
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const line = i + 1
    const cat = cats.get(norm(r[idx.category] ?? ''))
    const amount = parseNum(r[idx.amount])
    const cur = ((idx.currency >= 0 ? r[idx.currency]?.trim().toUpperCase() : '') || 'UZS') as Currency
    const date = (idx.date >= 0 ? parseDate(r[idx.date]) : null) ?? todayIso()
    if (!cat || amount === null || amount <= 0) {
      res.skipped++
      res.messages.push(`Строка ${line}: пропущена — неизвестная категория или некорректная сумма.`)
      continue
    }
    if (!['UZS', 'CNY', 'USD'].includes(cur)) {
      res.skipped++
      res.messages.push(`Строка ${line}: неизвестная валюта «${cur}».`)
      continue
    }
    const rate = (idx.rate >= 0 ? parseNum(r[idx.rate]) : null) ?? rateFor(cur, date) ?? 0
    const batchNo = idx.batch >= 0 ? r[idx.batch]?.trim() : ''
    const batchId = batchNo ? (batches.get(norm(batchNo)) ?? null) : null
    if (batchNo && !batchId) {
      res.skipped++
      res.messages.push(`Строка ${line}: партия «${batchNo}» не найдена.`)
      continue
    }
    try {
      await saveExpense(null, {
        expense_date: date,
        category_id: cat.id,
        amount,
        currency: cur,
        rate_to_uzs: rate,
        batch_id: batchId,
        batch_item_id: null,
        allocation_method: null,
        payment_method: 'transfer',
        payment_status: 'paid',
        due_date: null,
        comment: (idx.comment >= 0 ? r[idx.comment]?.trim() : '') || null,
      })
      res.created++
    } catch (e) {
      res.skipped++
      res.messages.push(`Строка ${line}: ${e instanceof Error ? e.message : 'ошибка'}`)
    }
  }
  return res
}

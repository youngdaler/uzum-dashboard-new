import { getState } from '@/data/store'

export type Cell = string | number | null | undefined

function csvEscape(v: Cell): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** CSV с разделителем «;» и BOM — корректно открывается в Excel с русской локалью. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows].map((r) => r.map(csvEscape).join(';')).join('\r\n')
}

export function downloadCsv(name: string, headers: string[], rows: Cell[][]): void {
  const blob = new Blob(['﻿' + toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' })
  triggerDownload(blob, `${name}.csv`)
}

export async function downloadXlsx(name: string, headers: string[], rows: Cell[][]): Promise<void> {
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  const data = [
    headers.map((h) => ({ value: h, fontWeight: 'bold' as const })),
    ...rows.map((r) =>
      r.map((c) => {
        if (c === null || c === undefined || c === '') return null
        return typeof c === 'number' ? { value: c, type: Number } : { value: String(c), type: String }
      }),
    ),
  ]
  await writeExcelFile(data as never).toFile(`${name}.xlsx`)
}

/** Экспорт в формате из настроек профиля (CSV или Excel). */
export async function exportTable(name: string, headers: string[], rows: Cell[][]): Promise<void> {
  const fmt = getState().db.profile?.export_format ?? 'csv'
  const stamp = new Date().toISOString().slice(0, 10)
  const file = `${name}_${stamp}`
  if (fmt === 'xlsx') await downloadXlsx(file, headers, rows)
  else downloadCsv(file, headers, rows)
}

export function downloadJson(name: string, data: unknown): void {
  triggerDownload(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${name}.json`)
}

// ---------------------------------------------------------------------------
// Разбор CSV (для импорта). Поддерживает кавычки, «;» «,» и табуляцию, BOM.
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const delim = [';', '\t', ','].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ';')
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === delim) {
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cur)
      cur = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else cur += ch
  }
  row.push(cur)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}

/** Число из строки CSV: пробелы/неразрывные пробелы как разделители тысяч, запятая как десятичный знак. */
export function parseNum(s: string | undefined): number | null {
  if (s === undefined) return null
  const t = s.replace(/[\s ]/g, '').replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Дата из строки CSV: yyyy-mm-dd или dd.mm.yyyy → ISO; иначе null. */
export function parseDate(s: string | undefined): string | null {
  if (!s) return null
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Не удалось прочитать файл.'))
    r.readAsText(file, 'utf-8')
  })
}

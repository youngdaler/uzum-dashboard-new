import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form'
import { exportTable, type Cell } from '@/lib/export'
import { cn } from '@/lib/utils'

export interface Column<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  /** Значение для сортировки; без него колонка не сортируется. */
  sort?: (row: T) => number | string | null | undefined
  /** Значение для экспорта; без него колонка в файл не попадает. */
  csv?: (row: T) => Cell
  /** Заголовок в экспорте (по умолчанию — header, если строка). */
  csvHeader?: string
  align?: 'left' | 'right'
  className?: string
}

interface Props<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  /** Текст строки для поиска; без него поле поиска скрыто. */
  searchText?: (row: T) => string
  searchPlaceholder?: string
  toolbar?: ReactNode
  defaultSort?: { key: string; dir: 'asc' | 'desc' }
  pageSize?: number
  onRowClick?: (row: T) => void
  empty?: ReactNode
  footer?: ReactNode
  exportName?: string
  className?: string
}

const cmp = (a: number | string | null | undefined, b: number | string | null | undefined): number => {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'ru', { numeric: true })
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = 'Поиск…',
  toolbar,
  defaultSort,
  pageSize = 15,
  onRowClick,
  empty,
  footer,
  exportName,
  className,
}: Props<T>) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(defaultSort ?? null)
  const [page, setPage] = useState(0)

  const processed = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = q && searchText ? rows.filter((r) => searchText(r).toLowerCase().includes(q)) : rows
    if (sort) {
      const col = columns.find((c) => c.key === sort.key)
      if (col?.sort) {
        const f = col.sort
        const dir = sort.dir === 'asc' ? 1 : -1
        list = [...list].sort((a, b) => cmp(f(a), f(b)) * dir)
      }
    }
    return list
  }, [rows, query, sort, columns, searchText])

  const pages = Math.max(1, Math.ceil(processed.length / pageSize))
  const cur = Math.min(page, pages - 1)
  const visible = processed.slice(cur * pageSize, cur * pageSize + pageSize)

  const toggleSort = (key: string) => {
    setPage(0)
    setSort((s) => (s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'desc' }))
  }

  const doExport = async () => {
    const cols = columns.filter((c) => c.csv)
    try {
      await exportTable(
        exportName ?? 'export',
        cols.map((c) => c.csvHeader ?? (typeof c.header === 'string' ? c.header : c.key)),
        processed.map((r) => cols.map((c) => c.csv!(r))),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось выгрузить файл.')
    }
  }

  return (
    <div className={cn('rounded-xl border bg-card', className)}>
      {(searchText || toolbar || exportName) && (
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          {searchText && (
            <div className="relative min-w-48 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(0)
                }}
                placeholder={searchPlaceholder}
                className="pl-8"
                aria-label="Поиск"
              />
            </div>
          )}
          <div className="flex flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          {exportName && (
            <Button variant="outline" size="sm" onClick={doExport} disabled={processed.length === 0}>
              <Download /> Экспорт
            </Button>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              {columns.map((c) => {
                const active = sort?.key === c.key
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('px-3 py-2 font-medium whitespace-nowrap', c.align === 'right' ? 'text-right' : 'text-left', c.className)}
                  >
                    {c.sort ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className={cn('inline-flex items-center gap-1 hover:text-foreground', c.align === 'right' && 'flex-row-reverse')}
                      >
                        {c.header}
                        {active ? sort!.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn('border-b last:border-0 hover:bg-muted/40', onRowClick && 'cursor-pointer')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-3 py-2.5 align-middle', c.align === 'right' && 'num text-right', c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-muted-foreground">
                  {query ? 'Ничего не найдено по запросу.' : (empty ?? 'Нет данных.')}
                </td>
              </tr>
            )}
          </tbody>
          {footer && visible.length > 0 && <tfoot>{footer}</tfoot>}
        </table>
      </div>
      {processed.length > pageSize && (
        <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
          <span>
            {cur * pageSize + 1}–{Math.min((cur + 1) * pageSize, processed.length)} из {processed.length}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" disabled={cur === 0} onClick={() => setPage(cur - 1)} aria-label="Назад">
              <ChevronLeft />
            </Button>
            <span className="px-1">
              {cur + 1} / {pages}
            </span>
            <Button variant="ghost" size="icon" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} aria-label="Вперёд">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

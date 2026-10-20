import { CheckCircle2, Pencil, Plus, Receipt, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DataTable, type Column } from '@/components/data-table'
import { DateRangeFilter, EmptyState, Money, PageHeader, StatCard } from '@/components/common'
import { ExpenseForm } from '@/components/forms/expense-form'
import { ImportButton } from '@/components/import-button'
import { Badge, Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, useConfirm } from '@/components/ui/dialog'
import { Select } from '@/components/ui/form'
import { deleteExpense, markExpensePaid } from '@/data/actions'
import { useAppState, useDerived } from '@/data/store'
import { useAction } from '@/hooks/use-action'
import { PAYMENT_METHOD_LABEL } from '@/lib/constants'
import { formatDate, formatMoney, todayIso } from '@/lib/format'
import { EXPENSE_CSV_HEADERS, importExpensesCsv } from '@/lib/importers'
import { sum } from '@/lib/money'
import type { Expense } from '@/types/db'

const SCOPE_LABEL = { batch: 'Вся партия', item: 'Товар в партии', operating: 'Операционный' } as const

export default function Expenses() {
  const { db } = useAppState()
  const d = useDerived()
  const confirm = useConfirm()
  const { run } = useAction()
  const [editing, setEditing] = useState<Expense | 'new' | null>(null)
  const [range, setRange] = useState({ from: '', to: '' })
  const [category, setCategory] = useState('')
  const [batch, setBatch] = useState('')
  const [status, setStatus] = useState<'' | 'paid' | 'pending'>('')

  const catName = (id: string) => d.categoriesById.get(id)?.name ?? '—'
  const batchNo = (id: string | null) => (id ? (db.purchase_batches.find((b) => b.id === id)?.batch_no ?? '—') : '—')

  const rows = useMemo(
    () =>
      db.expenses.filter(
        (e) =>
          (!range.from || e.expense_date >= range.from) &&
          (!range.to || e.expense_date <= range.to) &&
          (!category || e.category_id === category) &&
          (!batch || (batch === 'none' ? !e.batch_id : e.batch_id === batch)) &&
          (!status || e.payment_status === status),
      ),
    [db.expenses, range, category, batch, status],
  )

  const total = sum(rows.map((e) => e.amount_uzs))
  const landed = sum(rows.filter((e) => e.scope !== 'operating').map((e) => e.amount_uzs))
  const operating = sum(rows.filter((e) => e.scope === 'operating').map((e) => e.amount_uzs))
  const pending = sum(rows.filter((e) => e.payment_status === 'pending').map((e) => e.amount_uzs))

  const columns: Column<Expense>[] = [
    { key: 'date', header: 'Дата', sort: (e) => e.expense_date, csv: (e) => e.expense_date, cell: (e) => formatDate(e.expense_date) },
    { key: 'cat', header: 'Категория', sort: (e) => catName(e.category_id), csv: (e) => catName(e.category_id), cell: (e) => <span className="font-medium">{catName(e.category_id)}</span> },
    { key: 'scope', header: 'Учёт', csv: (e) => SCOPE_LABEL[e.scope], cell: (e) => <Badge tone={e.scope === 'operating' ? 'neutral' : 'primary'}>{SCOPE_LABEL[e.scope]}</Badge> },
    { key: 'batch', header: 'Партия', sort: (e) => batchNo(e.batch_id), csv: (e) => batchNo(e.batch_id), cell: (e) => batchNo(e.batch_id) },
    { key: 'orig', header: 'Сумма', align: 'right', sort: (e) => e.amount, csv: (e) => e.amount, cell: (e) => formatMoney(e.amount, e.currency) },
    { key: 'cur', header: 'Валюта', csv: (e) => e.currency, cell: (e) => e.currency },
    { key: 'rate', header: 'Курс', align: 'right', csv: (e) => (e.currency === 'UZS' ? null : e.rate_to_uzs), cell: (e) => (e.currency === 'UZS' ? '—' : e.rate_to_uzs) },
    { key: 'uzs', header: 'В UZS', align: 'right', sort: (e) => e.amount_uzs, csv: (e) => e.amount_uzs, cell: (e) => <Money value={e.amount_uzs} className="font-medium" /> },
    { key: 'pay', header: 'Оплата', csv: (e) => `${PAYMENT_METHOD_LABEL[e.payment_method]}, ${e.payment_status === 'paid' ? 'оплачено' : 'не оплачено'}`, cell: (e) => (
      <div>
        <div className="text-xs text-muted-foreground">{PAYMENT_METHOD_LABEL[e.payment_method]}</div>
        {e.payment_status === 'pending' ? <Badge tone={e.due_date && e.due_date < todayIso() ? 'danger' : 'warning'}>к оплате{e.due_date ? ` до ${formatDate(e.due_date)}` : ''}</Badge> : <span className="text-xs text-success">оплачено</span>}
      </div>
    ) },
    { key: 'note', header: 'Комментарий', csv: (e) => e.comment ?? '', cell: (e) => <span className="block max-w-48 truncate text-muted-foreground" title={e.comment ?? ''}>{e.comment}</span> },
    {
      key: 'act',
      header: '',
      align: 'right',
      cell: (e) => (
        <div className="flex justify-end gap-0.5">
          {e.payment_status === 'pending' && (
            <Button variant="ghost" size="icon" aria-label="Отметить оплаченным" title="Отметить оплаченным" onClick={() => void run(() => markExpensePaid(e.id), 'Отмечено как оплаченное')}>
              <CheckCircle2 className="text-success" />
            </Button>
          )}
          <Button variant="ghost" size="icon" aria-label="Изменить" onClick={() => setEditing(e)}><Pencil /></Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Удалить"
            onClick={async () => {
              if (await confirm({ title: 'Удалить расход?', description: e.batch_id ? 'Себестоимость партии будет пересчитана.' : undefined, confirmLabel: 'Удалить', destructive: true })) await run(() => deleteExpense(e.id), 'Расход удалён')
            }}
          >
            <Trash2 className="text-danger" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Расходы"
        description="Журнал расходов. Расходы, привязанные к партии (карго, таможня и др.), входят в себестоимость товара и не вычитаются из прибыли повторно; операционные расходы относятся к периоду."
        actions={
          <>
            <ImportButton run={importExpensesCsv} templateName="shablon-rashody" templateHeaders={EXPENSE_CSV_HEADERS} templateExample={['2026-10-01', 'Реклама', 150000, 'UZS', '', '', 'Таргетированная реклама']} />
            <Button onClick={() => setEditing('new')}><Plus /> Добавить расход</Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Всего (по фильтру)" value={<Money value={total} />} icon={Receipt} sub={`${rows.length} записей`} />
        <StatCard label="В себестоимость партий" value={<Money value={landed} />} />
        <StatCard label="Операционные" value={<Money value={operating} />} />
        <StatCard label="Не оплачено" value={<Money value={pending} />} tone={pending.gt(0) ? 'warning' : 'neutral'} />
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(e) => e.id}
        searchText={(e) => `${catName(e.category_id)} ${e.comment ?? ''} ${batchNo(e.batch_id)}`}
        searchPlaceholder="Поиск по категории или комментарию"
        defaultSort={{ key: 'date', dir: 'desc' }}
        exportName="rashody"
        empty={db.expenses.length === 0 ? <EmptyState icon={Receipt} title="Расходов пока нет" description="Добавьте первый расход или импортируйте CSV." /> : 'По выбранным фильтрам ничего нет.'}
        toolbar={
          <>
            <DateRangeFilter from={range.from} to={range.to} onChange={setRange} />
            <Select aria-label="Категория" value={category} onChange={(e) => setCategory(e.target.value)} className="w-44">
              <option value="">Все категории</option>
              {db.categories.filter((c) => c.kind === 'expense').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select aria-label="Партия" value={batch} onChange={(e) => setBatch(e.target.value)} className="w-40">
              <option value="">Все партии</option>
              <option value="none">Без партии</option>
              {db.purchase_batches.map((b) => <option key={b.id} value={b.id}>{b.batch_no}</option>)}
            </Select>
            <Select aria-label="Статус оплаты" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-36">
              <option value="">Любая оплата</option>
              <option value="paid">Оплачено</option>
              <option value="pending">Не оплачено</option>
            </Select>
          </>
        }
        footer={
          <tr className="bg-muted/40 font-medium">
            <td className="px-3 py-2" colSpan={7}>Итого по фильтру</td>
            <td className="num px-3 py-2 text-right"><Money value={total} /></td>
            <td colSpan={3} />
          </tr>
        }
      />
      <Card className="mt-3 border-dashed px-4 py-3 text-xs text-muted-foreground">
        Комиссия, логистика и удержания Uzum вводятся в строках продаж, а не здесь — так они не учитываются дважды.
      </Card>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Новый расход' : 'Изменить расход'} size="lg">
        {editing !== null && <ExpenseForm expense={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      </Dialog>
    </>
  )
}

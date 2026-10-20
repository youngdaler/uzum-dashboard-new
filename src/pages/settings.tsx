import { zodResolver } from '@hookform/resolvers/zod'
import { Download, LogOut, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { DataTable, type Column } from '@/components/data-table'
import { Notice, PageHeader } from '@/components/common'
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter, useConfirm } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  addFeeSetting,
  clearDemoData,
  deleteCategory,
  deleteFeeSetting,
  deleteRate,
  deleteSupplier,
  hasDemoData,
  latestRate,
  loadDemoData,
  saveCategory,
  saveRate,
  saveSupplier,
  updateProfile,
} from '@/data/actions'
import { resetLocalData, signOut, useAppState } from '@/data/store'
import { useAction } from '@/hooks/use-action'
import { COST_METHOD_LABEL } from '@/lib/constants'
import { downloadJson } from '@/lib/export'
import { formatDate, formatNumber, todayIso } from '@/lib/format'
import type { Category, ExchangeRate, FeeSetting, Supplier } from '@/types/db'

// ---------------------------------------------------------------------------
// Профиль и параметры расчёта
// ---------------------------------------------------------------------------
const profileSchema = z.object({
  full_name: z.string().trim(),
  business_name: z.string().trim(),
  cost_method: z.enum(['fifo', 'wac']),
  tax_mode: z.enum(['estimate', 'actual']),
  tax_rate_pct: z.number({ error: 'Введите ставку' }).min(0).max(100, 'Не больше 100'),
  tax_base: z.enum(['revenue', 'profit']),
  default_min_stock: z.number({ error: 'Введите число' }).int('Только целое').min(0),
  export_format: z.enum(['csv', 'xlsx']),
})
type ProfileValues = z.infer<typeof profileSchema>

function ProfileForm() {
  const { db } = useAppState()
  const { busy, run } = useAction()
  const p = db.profile
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isDirty },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      full_name: p?.full_name ?? '',
      business_name: p?.business_name ?? '',
      cost_method: p?.cost_method ?? 'wac',
      tax_mode: p?.tax_mode ?? 'estimate',
      tax_rate_pct: p?.tax_rate_pct ?? 0,
      tax_base: p?.tax_base ?? 'revenue',
      default_min_stock: p?.default_min_stock ?? 5,
      export_format: p?.export_format ?? 'csv',
    },
  })
  const taxMode = watch('tax_mode')
  return (
    <form onSubmit={handleSubmit((v) => run(() => updateProfile(v), 'Настройки сохранены'))} noValidate className="space-y-4">
      <Card>
        <CardHeader title="Профиль" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Имя"><Input {...register('full_name')} /></Field>
          <Field label="Название бизнеса"><Input {...register('business_name')} /></Field>
          <Field label="Основная валюта" hint="Все суммы хранятся и отображаются в UZS. CNY и USD пересчитываются по курсу на дату операции.">
            <Input value="UZS — узбекский сум" disabled readOnly />
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Расчёт себестоимости" description="Метод применяется ко всей истории одинаково: при смене все остатки и прибыль пересчитываются заново." />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Метод списания себестоимости">
            <Select {...register('cost_method')}>
              <option value="wac">{COST_METHOD_LABEL.wac}</option>
              <option value="fifo">{COST_METHOD_LABEL.fifo}</option>
            </Select>
          </Field>
          <Field label="Минимальный остаток для новых товаров, шт." error={errors.default_min_stock?.message}>
            <Input type="number" step="1" min="0" {...register('default_min_stock', { valueAsNumber: true })} />
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Налоги" description="Укажите ставку по вашему режиму налогообложения. Приложение не знает ваш режим и не подставляет ставку само." />
        <CardBody className="grid gap-3 sm:grid-cols-3">
          <Field label="Как учитывать налог">
            <Select {...register('tax_mode')}>
              <option value="estimate">Расчётный (ставка × база)</option>
              <option value="actual">Фактический (расходы «Налоги»)</option>
            </Select>
          </Field>
          <Field label="Ставка, %" error={errors.tax_rate_pct?.message}>
            <Input type="number" step="any" min="0" disabled={taxMode === 'actual'} {...register('tax_rate_pct', { valueAsNumber: true })} />
          </Field>
          <Field label="База налога">
            <Select disabled={taxMode === 'actual'} {...register('tax_base')}>
              <option value="revenue">Выручка</option>
              <option value="profit">Операционная прибыль</option>
            </Select>
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Экспорт" />
        <CardBody className="max-w-xs">
          <Field label="Формат выгрузки таблиц">
            <Select {...register('export_format')}>
              <option value="csv">CSV</option>
              <option value="xlsx">Excel (.xlsx)</option>
            </Select>
          </Field>
        </CardBody>
      </Card>
      <Button type="submit" disabled={busy || !isDirty}>Сохранить настройки</Button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Курсы
// ---------------------------------------------------------------------------
const rateSchema = z.object({
  pair: z.enum(['CNY_UZS', 'USD_UZS']),
  rate: z.number({ error: 'Введите курс' }).positive('Курс должен быть больше нуля'),
  date: z.string().min(1, 'Укажите дату'),
})
type RateValues = z.infer<typeof rateSchema>
const PAIR_LABEL = { CNY_UZS: 'CNY → UZS', USD_UZS: 'USD → UZS' } as const

function RatesTab() {
  const { db } = useAppState()
  const confirm = useConfirm()
  const { busy, run } = useAction()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RateValues>({ resolver: zodResolver(rateSchema), defaultValues: { pair: 'CNY_UZS', rate: undefined, date: todayIso() } })
  const cny = latestRate('CNY_UZS')
  const usd = latestRate('USD_UZS')
  const rows = [...db.exchange_rates].sort((a, b) => b.rate_date.localeCompare(a.rate_date) || b.created_at.localeCompare(a.created_at))
  const cols: Column<ExchangeRate>[] = [
    { key: 'd', header: 'Дата', sort: (r) => r.rate_date, csv: (r) => r.rate_date, cell: (r) => formatDate(r.rate_date) },
    { key: 'p', header: 'Пара', csv: (r) => PAIR_LABEL[r.pair], cell: (r) => PAIR_LABEL[r.pair] },
    { key: 'r', header: 'Курс', align: 'right', sort: (r) => r.rate, csv: (r) => r.rate, cell: (r) => formatNumber(r.rate, 2) },
    { key: 'a', header: '', align: 'right', cell: (r) => (<Button variant="ghost" size="icon" aria-label="Удалить" onClick={async () => { if (await confirm({ title: 'Удалить курс?', description: 'Уже созданные партии и расходы хранят свой курс и не изменятся.', confirmLabel: 'Удалить', destructive: true })) await run(() => deleteRate(r.id), 'Курс удалён') }}><Trash2 className="text-danger" /></Button>) },
  ]
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Текущие курсы" description="Последний введённый курс" />
          <CardBody className="space-y-1 text-sm">
            <div className="flex justify-between"><span>CNY → UZS</span><b className="num">{cny ? formatNumber(cny, 2) : '—'}</b></div>
            <div className="flex justify-between"><span>USD → UZS</span><b className="num">{usd ? formatNumber(usd, 2) : '—'}</b></div>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Обновить курс вручную" description="Курсы автоматически не загружаются: введите значение из вашего банка или обменника. Прошлые партии сохраняют курс на дату закупки." />
          <CardBody>
            <form onSubmit={handleSubmit((v) => run(() => saveRate(v.pair, v.rate, v.date), 'Курс сохранён'))} noValidate className="grid items-start gap-3 sm:grid-cols-4">
              <Field label="Пара"><Select {...register('pair')}><option value="CNY_UZS">CNY → UZS</option><option value="USD_UZS">USD → UZS</option></Select></Field>
              <Field label="Курс" error={errors.rate?.message}><Input type="number" step="any" min="0" {...register('rate', { valueAsNumber: true })} /></Field>
              <Field label="Дата" error={errors.date?.message}><Input type="date" {...register('date')} /></Field>
              <div className="pt-5"><Button type="submit" disabled={busy}>Сохранить</Button></div>
            </form>
          </CardBody>
        </Card>
      </div>
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} defaultSort={{ key: 'd', dir: 'desc' }} exportName="kursy" empty="Курсов пока нет." />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Тарифы Uzum (с историей)
// ---------------------------------------------------------------------------
const feeSchema = z.object({
  category_id: z.string(),
  effective_from: z.string().min(1, 'Укажите дату'),
  commission_pct: z.number({ error: 'Введите комиссию' }).min(0).max(100, 'Не больше 100'),
  logistics_fee_uzs: z.number({ error: 'Введите сумму' }).min(0),
  processing_fee_uzs: z.number({ error: 'Введите сумму' }).min(0),
  other_pct: z.number({ error: 'Введите процент' }).min(0).max(100),
  note: z.string(),
})
type FeeValues = z.infer<typeof feeSchema>

function FeesTab() {
  const { db } = useAppState()
  const confirm = useConfirm()
  const { busy, run } = useAction()
  const [open, setOpen] = useState(false)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FeeValues>({ resolver: zodResolver(feeSchema), defaultValues: { category_id: '', effective_from: todayIso(), commission_pct: 0, logistics_fee_uzs: 0, processing_fee_uzs: 0, other_pct: 0, note: '' } })
  const catName = (id: string | null) => (id ? (db.categories.find((c) => c.id === id)?.name ?? '—') : 'Все категории')
  const rows = [...db.marketplace_fee_settings].sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at))
  const cols: Column<FeeSetting>[] = [
    { key: 'd', header: 'Действует с', sort: (f) => f.effective_from, csv: (f) => f.effective_from, cell: (f) => formatDate(f.effective_from) },
    { key: 'c', header: 'Категория', sort: (f) => catName(f.category_id), csv: (f) => catName(f.category_id), cell: (f) => catName(f.category_id) },
    { key: 'cm', header: 'Комиссия, %', align: 'right', sort: (f) => f.commission_pct, csv: (f) => f.commission_pct, cell: (f) => formatNumber(f.commission_pct, 2) },
    { key: 'l', header: 'Логистика, UZS', align: 'right', csv: (f) => f.logistics_fee_uzs, cell: (f) => formatNumber(f.logistics_fee_uzs) },
    { key: 'pr', header: 'Обработка, UZS', align: 'right', csv: (f) => f.processing_fee_uzs, cell: (f) => formatNumber(f.processing_fee_uzs) },
    { key: 'o', header: 'Прочие, %', align: 'right', csv: (f) => f.other_pct, cell: (f) => formatNumber(f.other_pct, 2) },
    { key: 'n', header: 'Примечание', csv: (f) => f.note ?? '', cell: (f) => <span className="text-muted-foreground">{f.note}</span> },
    { key: 'a', header: '', align: 'right', cell: (f) => (<Button variant="ghost" size="icon" aria-label="Удалить" onClick={async () => { if (await confirm({ title: 'Удалить запись тарифа?', description: 'Расчёты для дат этого периода пересчитаются по предыдущей записи.', confirmLabel: 'Удалить', destructive: true })) await run(() => deleteFeeSetting(f.id), 'Запись удалена') }}><Trash2 className="text-danger" /></Button>) },
  ]
  const onSubmit = handleSubmit(async (v) => {
    const ok = await run(() => addFeeSetting({ ...v, category_id: v.category_id || null, note: v.note.trim() || null }), 'Тариф добавлен')
    if (ok) {
      setOpen(false)
      reset()
    }
  })
  return (
    <div className="space-y-3">
      <Notice tone="primary">Тарифы Uzum зависят от категории и условий. Приложение не содержит «официальных» значений — введите их из вашего кабинета продавца. Новая запись действует с указанной даты, старые сохраняются как история, поэтому расчёты по прошлым партиям не меняются.</Notice>
      <DataTable rows={rows} columns={cols} rowKey={(f) => f.id} defaultSort={{ key: 'd', dir: 'desc' }} exportName="tarify-uzum" empty="Тарифы не заданы — комиссия будет считаться как 0%, пока вы не добавите запись." toolbar={<Button size="sm" onClick={() => setOpen(true)}><Plus /> Новый тариф</Button>} />
      <Dialog open={open} onOpenChange={setOpen} title="Новый тариф Uzum" description="Новая запись действует с выбранной даты.">
        <form onSubmit={onSubmit} noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Категория товаров"><Select {...register('category_id')}><option value="">Все категории (общий тариф)</option>{db.categories.filter((c) => c.kind === 'product').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Действует с" error={errors.effective_from?.message}><Input type="date" {...register('effective_from')} /></Field>
            <Field label="Комиссия маркетплейса, %" error={errors.commission_pct?.message}><Input type="number" step="any" min="0" {...register('commission_pct', { valueAsNumber: true })} /></Field>
            <Field label="Прочие удержания, % от цены" error={errors.other_pct?.message}><Input type="number" step="any" min="0" {...register('other_pct', { valueAsNumber: true })} /></Field>
            <Field label="Логистика на единицу, UZS" error={errors.logistics_fee_uzs?.message}><Input type="number" step="any" min="0" {...register('logistics_fee_uzs', { valueAsNumber: true })} /></Field>
            <Field label="Обработка заказа на единицу, UZS" error={errors.processing_fee_uzs?.message}><Input type="number" step="any" min="0" {...register('processing_fee_uzs', { valueAsNumber: true })} /></Field>
            <Field label="Примечание" className="sm:col-span-2"><Textarea rows={2} {...register('note')} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
            <Button type="submit" disabled={busy}>Добавить</Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Справочники: категории и поставщики
// ---------------------------------------------------------------------------
const nameSchema = z.object({ name: z.string().trim().min(1, 'Введите название') })

function NameDialog({ title, initial, onSave, onClose }: { title: string; initial: string; onSave: (name: string) => Promise<unknown>; onClose: () => void }) {
  const { busy, run } = useAction()
  const { register, handleSubmit, formState: { errors } } = useForm<{ name: string }>({ resolver: zodResolver(nameSchema), defaultValues: { name: initial } })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title} size="sm">
      <form onSubmit={handleSubmit(async (v) => { if (await run(() => onSave(v.name), 'Сохранено')) onClose() })} noValidate>
        <Field label="Название" error={errors.name?.message}><Input autoFocus {...register('name')} /></Field>
        <DialogFooter><Button variant="outline" onClick={onClose}>Отмена</Button><Button type="submit" disabled={busy}>Сохранить</Button></DialogFooter>
      </form>
    </Dialog>
  )
}

function CategoryList({ kind, title, costType }: { kind: 'product' | 'expense'; title: string; costType?: 'landed' | 'operating' }) {
  const { db } = useAppState()
  const confirm = useConfirm()
  const { run } = useAction()
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const list = db.categories.filter((c) => c.kind === kind)
  return (
    <Card>
      <CardHeader title={title} action={<Button size="sm" variant="outline" onClick={() => setEditing('new')}><Plus /> Добавить</Button>} />
      <CardBody>
        <ul className="divide-y text-sm">
          {list.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="flex items-center gap-2">{c.name}{kind === 'expense' && <Badge tone={c.cost_type === 'landed' ? 'primary' : 'neutral'}>{c.cost_type === 'landed' ? 'в себестоимость' : 'операционный'}</Badge>}</span>
              <span className="flex gap-0.5">
                <Button variant="ghost" size="icon" aria-label="Переименовать" onClick={() => setEditing(c)}><Pencil /></Button>
                <Button variant="ghost" size="icon" aria-label="Удалить" onClick={async () => { if (await confirm({ title: `Удалить «${c.name}»?`, description: 'Если категория используется, удалить её не получится.', confirmLabel: 'Удалить', destructive: true })) await run(() => deleteCategory(c.id), 'Категория удалена') }}><Trash2 className="text-danger" /></Button>
              </span>
            </li>
          ))}
          {list.length === 0 && <li className="py-3 text-muted-foreground">Пусто</li>}
        </ul>
      </CardBody>
      {editing && (
        <NameDialog
          title={editing === 'new' ? 'Новая категория' : 'Переименовать категорию'}
          initial={editing === 'new' ? '' : editing.name}
          onClose={() => setEditing(null)}
          onSave={(name) => saveCategory(editing === 'new' ? null : editing.id, { kind, name, cost_type: kind === 'expense' ? (costType ?? 'operating') : null })}
        />
      )}
    </Card>
  )
}

const supplierSchema = z.object({ name: z.string().trim().min(1, 'Введите название'), contact: z.string(), url: z.string(), notes: z.string() })
type SupplierValues = z.infer<typeof supplierSchema>

function SupplierDialog({ item, onClose }: { item: Supplier | null; onClose: () => void }) {
  const { busy, run } = useAction()
  const { register, handleSubmit, formState: { errors } } = useForm<SupplierValues>({ resolver: zodResolver(supplierSchema), defaultValues: { name: item?.name ?? '', contact: item?.contact ?? '', url: item?.url ?? '', notes: item?.notes ?? '' } })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={item ? 'Изменить поставщика' : 'Новый поставщик'}>
      <form onSubmit={handleSubmit(async (v) => { if (await run(() => saveSupplier(item?.id ?? null, { name: v.name, contact: v.contact.trim() || null, url: v.url.trim() || null, notes: v.notes.trim() || null }), 'Сохранено')) onClose() })} noValidate>
        <div className="grid gap-3">
          <Field label="Название" error={errors.name?.message}><Input autoFocus {...register('name')} /></Field>
          <Field label="Контакт"><Input {...register('contact')} placeholder="WeChat, телефон…" /></Field>
          <Field label="Ссылка на магазин"><Input {...register('url')} placeholder="https://…1688.com" /></Field>
          <Field label="Заметки"><Textarea rows={2} {...register('notes')} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Отмена</Button><Button type="submit" disabled={busy}>Сохранить</Button></DialogFooter>
      </form>
    </Dialog>
  )
}

function SuppliersCard() {
  const { db } = useAppState()
  const confirm = useConfirm()
  const { run } = useAction()
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  return (
    <Card>
      <CardHeader title="Поставщики" action={<Button size="sm" variant="outline" onClick={() => setEditing('new')}><Plus /> Добавить</Button>} />
      <CardBody>
        <ul className="divide-y text-sm">
          {db.suppliers.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
              <div className="min-w-0"><div className="truncate">{s.name}</div>{s.contact && <div className="truncate text-xs text-muted-foreground">{s.contact}</div>}</div>
              <span className="flex shrink-0 gap-0.5">
                <Button variant="ghost" size="icon" aria-label="Изменить" onClick={() => setEditing(s)}><Pencil /></Button>
                <Button variant="ghost" size="icon" aria-label="Удалить" onClick={async () => { if (await confirm({ title: `Удалить «${s.name}»?`, description: 'Если поставщик используется в товарах или партиях, удалить его не получится.', confirmLabel: 'Удалить', destructive: true })) await run(() => deleteSupplier(s.id), 'Поставщик удалён') }}><Trash2 className="text-danger" /></Button>
              </span>
            </li>
          ))}
          {db.suppliers.length === 0 && <li className="py-3 text-muted-foreground">Пока нет поставщиков</li>}
        </ul>
      </CardBody>
      {editing && <SupplierDialog item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Данные: демо, экспорт, сброс
// ---------------------------------------------------------------------------
function DataTab() {
  const { db, mode, user } = useAppState()
  const confirm = useConfirm()
  const { busy, run } = useAction()
  const demo = hasDemoData()
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Демонстрационные данные" description="Пример товаров, партий и продаж, чтобы увидеть, как работают расчёты. Удаляются одной кнопкой — ваши собственные записи не затрагиваются." />
        <CardBody className="flex flex-wrap gap-2">
          <Button disabled={busy || demo} onClick={() => void run(loadDemoData, 'Демо-данные загружены')}>Загрузить демо-данные</Button>
          <Button variant="outline" disabled={busy || !demo} onClick={async () => { if (await confirm({ title: 'Удалить демо-данные?', description: 'Будут удалены только записи, помеченные как демонстрационные.', confirmLabel: 'Удалить', destructive: true })) await run(clearDemoData, 'Демо-данные удалены') }}>Удалить демо-данные</Button>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Резервная копия" description="Полная выгрузка всех ваших данных в JSON." />
        <CardBody><Button variant="outline" onClick={() => downloadJson(`uzum-backup-${todayIso()}`, db)}><Download /> Скачать JSON</Button></CardBody>
      </Card>
      <Card>
        <CardHeader title="Хранилище" />
        <CardBody className="space-y-2 text-sm">
          {mode === 'supabase' ? (
            <p>Данные хранятся в Supabase. Вы вошли как <b>{user?.email}</b>. Каждый пользователь видит только свои данные (Row Level Security).</p>
          ) : (
            <>
              <Notice tone="warning">Режим без сервера: данные хранятся только в этом браузере (localStorage). Очистка данных сайта удалит их — делайте резервные копии. Чтобы подключить Supabase, заполните .env (см. README).</Notice>
              <Button variant="outline" className="text-danger" onClick={async () => { if (await confirm({ title: 'Стереть все данные в этом браузере?', description: 'Это действие необратимо. Сначала скачайте резервную копию.', confirmLabel: 'Стереть всё', destructive: true })) await run(resetLocalData, 'Данные очищены') }}><RotateCcw /> Стереть все данные</Button>
            </>
          )}
          {mode === 'supabase' && <Button variant="outline" onClick={() => void signOut()}><LogOut /> Выйти</Button>}
        </CardBody>
      </Card>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Настройки" description="Курсы, тарифы Uzum, методы расчёта, налоги и справочники." />
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Расчёты и налоги</TabsTrigger>
          <TabsTrigger value="rates">Курсы валют</TabsTrigger>
          <TabsTrigger value="fees">Тарифы Uzum</TabsTrigger>
          <TabsTrigger value="dicts">Справочники</TabsTrigger>
          <TabsTrigger value="data">Данные</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-3"><ProfileForm /></TabsContent>
        <TabsContent value="rates" className="mt-3"><RatesTab /></TabsContent>
        <TabsContent value="fees" className="mt-3"><FeesTab /></TabsContent>
        <TabsContent value="dicts" className="mt-3">
          <div className="grid gap-4 lg:grid-cols-3">
            <CategoryList kind="product" title="Категории товаров" />
            <CategoryList kind="expense" title="Категории расходов" costType="operating" />
            <SuppliersCard />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Новые категории расходов считаются операционными (относятся к периоду). Категории, входящие в себестоимость партий (карго, таможня и т. д.), заданы по умолчанию.</p>
        </TabsContent>
        <TabsContent value="data" className="mt-3"><DataTab /></TabsContent>
      </Tabs>
    </>
  )
}

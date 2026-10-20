import { zodResolver } from '@hookform/resolvers/zod'
import { Archive, ArchiveRestore, ImagePlus, Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { DataTable, type Column } from '@/components/data-table'
import { EmptyState, KeyValue, Money, PageHeader, Pct } from '@/components/common'
import { ImportButton } from '@/components/import-button'
import { Badge } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter, useConfirm } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/form'
import { archiveProduct, deleteProduct, saveProduct, type ProductValues } from '@/data/actions'
import { useAppState, useDerived } from '@/data/store'
import { useAction } from '@/hooks/use-action'
import { sellingParamsFor } from '@/lib/calc/derive'
import { unitEconomics } from '@/lib/calc/unit'
import { fileToCompressedDataUrl } from '@/lib/image'
import { formatNumber, todayIso } from '@/lib/format'
import { importProductsCsv, PRODUCT_CSV_HEADERS } from '@/lib/importers'
import { buildProductRows, COST_SOURCE_LABEL, type ProductRow } from '@/lib/productStats'
import type { Product } from '@/types/db'
import { kgToG, gToKg } from '@/lib/weight'

const money = z.number({ error: 'Введите число' }).min(0, 'Не может быть отрицательным')
const schema = z.object({
  name: z.string().trim().min(1, 'Укажите название'),
  sku: z.string().trim().min(1, 'Укажите артикул'),
  barcode: z.string().trim(),
  category_id: z.string(),
  supplier_id: z.string(),
  photo_url: z.string(),
  source_url: z.union([z.literal(''), z.url('Некорректная ссылка')]),
  purchase_price_cny: money,
  recommended_price_uzs: money,
  sale_price_uzs: money,
  commission_pct: z.number({ error: 'Введите число' }).min(0).max(100, 'Не более 100%').nullable(),
  packaging_cost_uzs: money,
  extra_cost_uzs: money,
  weight_g: money,
  volume_m3: money,
  min_stock: z.number({ error: 'Введите число' }).int('Целое число').min(0, 'Не может быть отрицательным'),
  expected_monthly_sales: z.number().min(0).nullable(),
  status: z.enum(['active', 'archived']),
})
type Values = z.infer<typeof schema>

const nullableNum = (v: unknown) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v))

function ProductForm({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { db } = useAppState()
  const derived = useDerived()
  const { busy, run } = useAction()
  const fileRef = useRef<HTMLInputElement>(null)
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: product
      ? {
          name: product.name,
          sku: product.sku,
          barcode: product.barcode ?? '',
          category_id: product.category_id ?? '',
          supplier_id: product.supplier_id ?? '',
          photo_url: product.photo_url ?? '',
          source_url: product.source_url ?? '',
          purchase_price_cny: product.purchase_price_cny,
          recommended_price_uzs: product.recommended_price_uzs,
          sale_price_uzs: product.sale_price_uzs,
          commission_pct: product.commission_pct,
          packaging_cost_uzs: product.packaging_cost_uzs,
          extra_cost_uzs: product.extra_cost_uzs,
          weight_g: kgToG(product.weight_kg),
          volume_m3: product.volume_m3,
          min_stock: product.min_stock,
          expected_monthly_sales: product.expected_monthly_sales,
          status: product.status,
        }
      : {
          name: '',
          sku: '',
          barcode: '',
          category_id: '',
          supplier_id: '',
          photo_url: '',
          source_url: '',
          purchase_price_cny: 0,
          recommended_price_uzs: 0,
          sale_price_uzs: 0,
          commission_pct: null,
          packaging_cost_uzs: 0,
          extra_cost_uzs: 0,
          weight_g: 0,
          volume_m3: 0,
          min_stock: db.profile?.default_min_stock ?? 5,
          expected_monthly_sales: null,
          status: 'active',
        },
  })

  const w = useWatch({ control })
  const photo = w.photo_url
  // Предпросмотр экономики единицы по введённым данным и текущей себестоимости.
  const preview = useMemo(() => {
    const row = product ? buildProductRows(db, derived, todayIso()).find((r) => r.product.id === product.id) : undefined
    const cost = row?.unitCost ?? null
    if (cost === null || !(w.sale_price_uzs && w.sale_price_uzs > 0)) return null
    const params = sellingParamsFor(db, { ...(product as Product), commission_pct: w.commission_pct ?? null, category_id: w.category_id || null }, todayIso())
    return unitEconomics({
      price: w.sale_price_uzs,
      commissionPct: w.commission_pct ?? params.commissionPct,
      logistics: params.logistics,
      otherPct: params.otherPct,
      packaging: w.packaging_cost_uzs ?? 0,
      extra: w.extra_cost_uzs ?? 0,
      unitCost: cost,
    })
  }, [db, derived, product, w.sale_price_uzs, w.commission_pct, w.packaging_cost_uzs, w.extra_cost_uzs, w.category_id])

  const productCats = db.categories.filter((c) => c.kind === 'product')

  const onPhoto = async (file: File | undefined) => {
    if (!file) return
    try {
      setValue('photo_url', await fileToCompressedDataUrl(file), { shouldDirty: true })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось загрузить фото.')
    }
  }

  const submit = handleSubmit((v) =>
    run(async () => {
      const { weight_g, ...rest } = v
      const payload: ProductValues = {
        ...rest,
        weight_kg: gToKg(weight_g),
        barcode: v.barcode || null,
        category_id: v.category_id || null,
        supplier_id: v.supplier_id || null,
        photo_url: v.photo_url || null,
        source_url: v.source_url || null,
      }
      await saveProduct(product?.id ?? null, payload)
      onClose()
    }, product ? 'Товар обновлён' : 'Товар добавлен'),
  )

  const num = (name: keyof Values) => register(name, { valueAsNumber: true })

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название *" error={errors.name?.message} className="sm:col-span-2">
          <Input {...register('name')} aria-invalid={!!errors.name} />
        </Field>
        <Field label="Артикул / SKU *" error={errors.sku?.message}>
          <Input {...register('sku')} aria-invalid={!!errors.sku} />
        </Field>
        <Field label="Штрихкод" error={errors.barcode?.message}>
          <Input {...register('barcode')} inputMode="numeric" />
        </Field>
        <Field label="Категория">
          <Select {...register('category_id')}>
            <option value="">— не выбрана —</option>
            {productCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Поставщик">
          <Select {...register('supplier_id')}>
            <option value="">— не выбран —</option>
            {db.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ссылка на товар у поставщика (1688, Taobao…)" error={errors.source_url?.message} className="sm:col-span-2">
          <Input {...register('source_url')} placeholder="https://detail.1688.com/…" aria-invalid={!!errors.source_url} />
        </Field>
        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Фотография</span>
          <div className="flex items-center gap-3">
            <div className="flex size-16 items-center justify-center overflow-hidden rounded-lg border bg-muted">
              {photo ? <img src={photo} alt="" className="size-full object-cover" /> : <Package className="size-6 text-muted-foreground" />}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <ImagePlus /> Загрузить
            </Button>
            {photo && (
              <Button variant="ghost" size="sm" onClick={() => setValue('photo_url', '', { shouldDirty: true })}>
                Убрать
              </Button>
            )}
          </div>
        </div>

        <Field label="Цена закупки, CNY" error={errors.purchase_price_cny?.message}>
          <Input type="number" step="0.01" {...num('purchase_price_cny')} aria-invalid={!!errors.purchase_price_cny} />
        </Field>
        <Field label="Вес единицы, г" error={errors.weight_g?.message}>
          <Input type="number" step="1" {...num('weight_g')} />
        </Field>
        <Field label="Объём единицы, м³" error={errors.volume_m3?.message}>
          <Input type="number" step="0.0001" {...num('volume_m3')} />
        </Field>
        <Field label="Рекомендуемая цена продажи, UZS" error={errors.recommended_price_uzs?.message}>
          <Input type="number" {...num('recommended_price_uzs')} />
        </Field>
        <Field label="Цена продажи на Uzum, UZS" error={errors.sale_price_uzs?.message}>
          <Input type="number" {...num('sale_price_uzs')} aria-invalid={!!errors.sale_price_uzs} />
        </Field>
        <Field label="Комиссия Uzum, %" error={errors.commission_pct?.message} hint="Пусто — берётся из тарифов в настройках">
          <Input type="number" step="0.1" {...register('commission_pct', { setValueAs: nullableNum })} />
        </Field>
        <Field label="Упаковка на единицу, UZS" error={errors.packaging_cost_uzs?.message}>
          <Input type="number" {...num('packaging_cost_uzs')} />
        </Field>
        <Field label="Доп. расходы на единицу, UZS" error={errors.extra_cost_uzs?.message}>
          <Input type="number" {...num('extra_cost_uzs')} />
        </Field>
        <Field label="Минимальный остаток, шт." error={errors.min_stock?.message}>
          <Input type="number" {...num('min_stock')} />
        </Field>
        <Field label="Ожидаемые продажи в месяц, шт." error={errors.expected_monthly_sales?.message} hint="Нужно для срока окупаемости партии">
          <Input type="number" {...register('expected_monthly_sales', { setValueAs: nullableNum })} />
        </Field>
        <Field label="Статус">
          <Select {...register('status')}>
            <option value="active">Активный</option>
            <option value="archived">В архиве</option>
          </Select>
        </Field>
      </div>

      {product && (
        <div className="mt-4 rounded-lg bg-muted/60 p-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Экономика единицы (по текущей себестоимости)</p>
          {preview ? (
            <KeyValue
              rows={[
                { label: 'Себестоимость единицы', value: <Money value={preview.unitCost} /> },
                { label: 'Чистая выплата Uzum', value: <Money value={preview.payout} /> },
                { label: 'Прибыль с единицы', value: <Money value={preview.profit} signed />, strong: true },
                { label: 'Маржинальность', value: <Pct value={preview.marginPct} /> },
                { label: 'ROI', value: <Pct value={preview.roiPct} /> },
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Недостаточно данных: нужна себестоимость (партия, остаток или цена закупки и курс) и цена продажи.</p>
          )}
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Отмена
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export default function ProductsPage() {
  const { db } = useAppState()
  const derived = useDerived()
  const confirm = useConfirm()
  const { run } = useAction()
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [cat, setCat] = useState('')
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active')

  const rows = useMemo(() => buildProductRows(db, derived, todayIso()), [db, derived])
  const filtered = useMemo(
    () => rows.filter((r) => (status === 'all' || r.product.status === status) && (!cat || r.product.category_id === cat)),
    [rows, cat, status],
  )

  const onDelete = async (p: Product) => {
    const ok = await confirm({
      title: `Удалить товар «${p.name}»?`,
      description: 'Действие необратимо. Если по товару есть партии, продажи или движения склада, удаление будет запрещено — тогда лучше отправить товар в архив.',
      confirmLabel: 'Удалить',
      destructive: true,
    })
    if (ok) await run(() => deleteProduct(p.id), 'Товар удалён')
  }

  const columns: Column<ProductRow>[] = [
    {
      key: 'name',
      header: 'Товар',
      sort: (r) => r.product.name,
      csv: (r) => r.product.name,
      csvHeader: 'Название',
      cell: (r) => (
        <div className="flex min-w-48 items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
            {r.product.photo_url ? <img src={r.product.photo_url} alt="" className="size-full object-cover" loading="lazy" /> : <Package className="size-4 text-muted-foreground" />}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{r.product.name}</div>
            {r.product.source_url && (
              <a href={r.product.source_url} target="_blank" rel="noreferrer noopener" className="text-xs text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                страница у поставщика
              </a>
            )}
          </div>
        </div>
      ),
    },
    { key: 'sku', header: 'Артикул', sort: (r) => r.product.sku, csv: (r) => r.product.sku, cell: (r) => <span className="text-muted-foreground">{r.product.sku}</span> },
    { key: 'cat', header: 'Категория', sort: (r) => r.categoryName, csv: (r) => r.categoryName, cell: (r) => r.categoryName },
    { key: 'sup', header: 'Поставщик', sort: (r) => r.supplierName, csv: (r) => r.supplierName, cell: (r) => <span className="text-muted-foreground">{r.supplierName}</span> },
    { key: 'cny', header: 'Закупка, ¥', align: 'right', sort: (r) => r.product.purchase_price_cny, csv: (r) => r.product.purchase_price_cny, cell: (r) => formatNumber(r.product.purchase_price_cny, 2) },
    {
      key: 'cost',
      header: 'Себестоимость',
      align: 'right',
      sort: (r) => r.unitCost?.toNumber(),
      csv: (r) => r.unitCost?.toDecimalPlaces(0).toNumber() ?? null,
      cell: (r) => (r.unitCost ? <span title={COST_SOURCE_LABEL[r.costSource]}><Money value={r.unitCost} />{r.costSource === 'estimate' && <span className="text-warning">*</span>}</span> : '—'),
    },
    { key: 'price', header: 'Цена Uzum', align: 'right', sort: (r) => r.product.sale_price_uzs, csv: (r) => r.product.sale_price_uzs, cell: (r) => <Money value={r.product.sale_price_uzs} /> },
    { key: 'profit', header: 'Прибыль/ед.', align: 'right', sort: (r) => r.unit?.profit.toNumber(), csv: (r) => r.unit?.profit.toDecimalPlaces(0).toNumber() ?? null, cell: (r) => (r.unit ? <Money value={r.unit.profit} signed /> : '—') },
    { key: 'margin', header: 'Маржа', align: 'right', sort: (r) => r.unit?.marginPct?.toNumber(), csv: (r) => r.unit?.marginPct?.toDecimalPlaces(1).toNumber() ?? null, cell: (r) => <Pct value={r.unit?.marginPct ?? null} /> },
    { key: 'roi', header: 'ROI', align: 'right', sort: (r) => r.unit?.roiPct?.toNumber(), csv: (r) => r.unit?.roiPct?.toDecimalPlaces(1).toNumber() ?? null, cell: (r) => <Pct value={r.unit?.roiPct ?? null} /> },
    {
      key: 'stock',
      header: 'Остаток',
      align: 'right',
      sort: (r) => r.stock?.stock ?? 0,
      csv: (r) => r.stock?.stock ?? 0,
      cell: (r) => {
        const s = r.stock?.stock ?? 0
        const low = s <= r.product.min_stock
        return <span className={low && r.product.status === 'active' ? 'font-medium text-danger' : ''}>{s}</span>
      },
    },
    { key: 'sold', header: 'Продано', align: 'right', sort: (r) => r.sold, csv: (r) => r.sold, cell: (r) => r.sold },
    {
      key: 'status',
      header: 'Статус',
      sort: (r) => r.product.status,
      csv: (r) => (r.product.status === 'active' ? 'Активный' : 'В архиве'),
      cell: (r) => <Badge tone={r.product.status === 'active' ? 'success' : 'neutral'}>{r.product.status === 'active' ? 'Активный' : 'Архив'}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" aria-label="Редактировать" title="Редактировать" onClick={() => setEditing(r.product)}>
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={r.product.status === 'active' ? 'В архив' : 'Из архива'}
            title={r.product.status === 'active' ? 'В архив' : 'Вернуть из архива'}
            onClick={() => void run(() => archiveProduct(r.product.id, r.product.status === 'active'), r.product.status === 'active' ? 'Товар в архиве' : 'Товар возвращён')}
          >
            {r.product.status === 'active' ? <Archive /> : <ArchiveRestore />}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Удалить" title="Удалить" onClick={() => void onDelete(r.product)}>
            <Trash2 className="text-danger" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Товары"
        description="Карточки товаров с себестоимостью, прибылью и остатками. Себестоимость берётся из партий и склада и обновляется автоматически."
        actions={
          <>
            <ImportButton
              run={importProductsCsv}
              templateName="шаблон_товары"
              templateHeaders={PRODUCT_CSV_HEADERS}
              templateExample={['Умная колонка', 'SPK-001', '4780000000001', 'Электроника', '', 45.5, 189000, 0.6, 5]}
            />
            <Button onClick={() => setEditing('new')}>
              <Plus /> Добавить товар
            </Button>
          </>
        }
      />

      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.product.id}
        searchText={(r) => `${r.product.name} ${r.product.sku} ${r.product.barcode ?? ''} ${r.categoryName} ${r.supplierName}`}
        searchPlaceholder="Название, артикул, штрихкод…"
        defaultSort={{ key: 'profit', dir: 'desc' }}
        exportName="товары"
        empty={
          rows.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Товаров пока нет"
              description="Добавьте первый товар вручную, импортируйте CSV или загрузите демо-данные в настройках."
              action={<Button onClick={() => setEditing('new')}><Plus /> Добавить товар</Button>}
            />
          ) : (
            'Нет товаров по выбранным фильтрам.'
          )
        }
        toolbar={
          <>
            <Select aria-label="Категория" value={cat} onChange={(e) => setCat(e.target.value)} className="w-44">
              <option value="">Все категории</option>
              {db.categories.filter((c) => c.kind === 'product').map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Статус" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-36">
              <option value="active">Активные</option>
              <option value="archived">В архиве</option>
              <option value="all">Все</option>
            </Select>
          </>
        }
        footer={
          filtered.some((r) => r.costSource === 'estimate') ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-2 text-xs text-muted-foreground">
                <span className="text-warning">*</span> себестоимость оценена по цене закупки и курсу без доставки — появится точное значение после первой партии.
              </td>
            </tr>
          ) : null
        }
      />

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? 'Новый товар' : 'Редактирование товара'}
        size="lg"
      >
        {editing !== null && <ProductForm key={editing === 'new' ? 'new' : editing.id} product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      </Dialog>
    </>
  )
}


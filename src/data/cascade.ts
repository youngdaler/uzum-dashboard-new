import type { Db, TableName } from '@/types/db'

/**
 * Зеркало внешних ключей схемы БД (ON DELETE ...) для клиента:
 *  - в локальном режиме (без Supabase) каскады выполняются здесь;
 *  - при работе с Supabase сервер выполняет те же каскады сам, а клиент использует тот же план,
 *    чтобы мгновенно обновить интерфейс и заранее показать понятную ошибку для RESTRICT.
 */
interface Rule {
  parent: TableName
  child: TableName
  fk: string
  onDelete: 'cascade' | 'setnull' | 'restrict'
}

const RULES: Rule[] = [
  { parent: 'categories', child: 'products', fk: 'category_id', onDelete: 'setnull' },
  { parent: 'categories', child: 'marketplace_fee_settings', fk: 'category_id', onDelete: 'cascade' },
  { parent: 'categories', child: 'expenses', fk: 'category_id', onDelete: 'restrict' },
  { parent: 'suppliers', child: 'products', fk: 'supplier_id', onDelete: 'setnull' },
  { parent: 'suppliers', child: 'purchase_batches', fk: 'supplier_id', onDelete: 'setnull' },
  { parent: 'products', child: 'purchase_batch_items', fk: 'product_id', onDelete: 'restrict' },
  { parent: 'products', child: 'sale_items', fk: 'product_id', onDelete: 'restrict' },
  { parent: 'products', child: 'inventory_movements', fk: 'product_id', onDelete: 'restrict' },
  { parent: 'purchase_batches', child: 'purchase_batch_items', fk: 'batch_id', onDelete: 'cascade' },
  { parent: 'purchase_batches', child: 'expenses', fk: 'batch_id', onDelete: 'cascade' },
  { parent: 'purchase_batches', child: 'payments', fk: 'batch_id', onDelete: 'cascade' },
  { parent: 'purchase_batches', child: 'inventory_movements', fk: 'batch_id', onDelete: 'cascade' },
  { parent: 'purchase_batch_items', child: 'expenses', fk: 'batch_item_id', onDelete: 'cascade' },
  { parent: 'purchase_batch_items', child: 'expense_allocations', fk: 'batch_item_id', onDelete: 'cascade' },
  { parent: 'purchase_batch_items', child: 'inventory_movements', fk: 'batch_item_id', onDelete: 'cascade' },
  { parent: 'expenses', child: 'expense_allocations', fk: 'expense_id', onDelete: 'cascade' },
  { parent: 'sales', child: 'sale_items', fk: 'sale_id', onDelete: 'cascade' },
  { parent: 'sale_items', child: 'returns', fk: 'sale_item_id', onDelete: 'cascade' },
  { parent: 'sale_items', child: 'inventory_movements', fk: 'sale_item_id', onDelete: 'cascade' },
  { parent: 'returns', child: 'inventory_movements', fk: 'return_id', onDelete: 'cascade' },
]

const TABLE_LABEL: Record<string, string> = {
  purchase_batch_items: 'позициями партий',
  sale_items: 'продажами',
  inventory_movements: 'движениями склада',
  expenses: 'расходами',
}

export interface DeletePlan {
  deleted: Map<TableName, Set<string>>
  nulled: { table: TableName; id: string; field: string }[]
  error: string | null
}

type Row = { id: string } & Record<string, unknown>

export function planDelete(db: Db, table: TableName, ids: string[]): DeletePlan {
  const deleted = new Map<TableName, Set<string>>()
  const nulled: DeletePlan['nulled'] = []
  const queue: { table: TableName; ids: string[] }[] = [{ table, ids }]
  const mark = (t: TableName, id: string): boolean => {
    let s = deleted.get(t)
    if (!s) {
      s = new Set()
      deleted.set(t, s)
    }
    if (s.has(id)) return false
    s.add(id)
    return true
  }
  while (queue.length) {
    const cur = queue.shift()!
    const fresh = cur.ids.filter((id) => mark(cur.table, id))
    if (fresh.length === 0) continue
    for (const rule of RULES.filter((r) => r.parent === cur.table && r.onDelete !== 'restrict')) {
      const rows = db[rule.child] as unknown as Row[]
      const hit = rows.filter((r) => fresh.includes(r[rule.fk] as string))
      if (rule.onDelete === 'cascade') queue.push({ table: rule.child, ids: hit.map((r) => r.id) })
      else for (const r of hit) nulled.push({ table: rule.child, id: r.id, field: rule.fk })
    }
  }
  // RESTRICT проверяется после сбора каскада: дочерние строки, удаляемые тем же каскадом, не мешают.
  let error: string | null = null
  for (const rule of RULES.filter((r) => r.onDelete === 'restrict')) {
    const parents = deleted.get(rule.parent)
    if (!parents || parents.size === 0) continue
    const childDeleted = deleted.get(rule.child) ?? new Set<string>()
    const rows = db[rule.child] as unknown as Row[]
    if (rows.some((r) => parents.has(r[rule.fk] as string) && !childDeleted.has(r.id))) {
      error = `Нельзя удалить: запись связана с ${TABLE_LABEL[rule.child] ?? 'другими данными'}.`
      break
    }
  }
  return { deleted, nulled, error }
}

/** Применяет план к состоянию (иммутабельно). */
export function applyPlan(db: Db, plan: DeletePlan): Db {
  const next: Db = { ...db }
  const nulledBy = new Map<string, DeletePlan['nulled']>()
  for (const n of plan.nulled) {
    const k = `${n.table}:${n.id}`
    nulledBy.set(k, [...(nulledBy.get(k) ?? []), n])
  }
  for (const key of Object.keys(db) as (keyof Db)[]) {
    if (key === 'profile') continue
    const t = key as TableName
    const del = plan.deleted.get(t)
    const rows = db[t] as unknown as Row[]
    const filtered = del ? rows.filter((r) => !del.has(r.id)) : rows
    const patched = filtered.map((r) => {
      const ns = nulledBy.get(`${t}:${r.id}`)
      if (!ns) return r
      const copy = { ...r }
      for (const n of ns) copy[n.field] = null
      return copy
    })
    ;(next as unknown as Record<string, unknown>)[t] = patched
  }
  return next
}

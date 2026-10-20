import { applyPlan, planDelete } from '@/data/cascade'
import { supabase } from '@/lib/supabase'
import { emptyDb, TABLE_NAMES, type Db, type Profile, type TableName } from '@/types/db'

export interface SessionUser {
  id: string
  email: string
}

export type AnyRow = { id: string } & Record<string, unknown>

/**
 * Единый интерфейс хранилища. Две реализации:
 *  - SupabaseBackend — PostgreSQL + Auth + RLS (основной режим);
 *  - LocalBackend    — localStorage браузера (демо/офлайн-режим без настройки сервера).
 * Все данные сохраняются в хранилище при каждой операции; состояние React — лишь кэш.
 */
export interface Backend {
  readonly mode: 'supabase' | 'local'
  getSessionUser(): Promise<SessionUser | null>
  signIn?(email: string, password: string): Promise<void>
  signUp?(email: string, password: string, fullName: string): Promise<{ needsConfirmation: boolean }>
  signOut?(): Promise<void>
  onAuthChange?(cb: (user: SessionUser | null) => void): () => void
  loadAll(user: SessionUser): Promise<Db>
  insert(table: TableName, rows: AnyRow[]): Promise<AnyRow[]>
  update(table: TableName, id: string, patch: Record<string, unknown>): Promise<AnyRow>
  remove(table: TableName, ids: string[]): Promise<void>
  updateProfile(patch: Partial<Profile>): Promise<Profile>
  /** Полностью очищает данные пользователя (для тестов/сброса локального режима). */
  reset?(): Promise<void>
}

const nowIso = () => new Date().toISOString()

// ---------------------------------------------------------------------------
// Local
// ---------------------------------------------------------------------------
const LOCAL_USER: SessionUser = { id: 'local-user', email: 'local@device' }
const STORAGE_KEY = 'uzum-dashboard:v1'

function defaultProfile(id: string): Profile {
  return {
    id,
    full_name: '',
    business_name: '',
    base_currency: 'UZS',
    language: 'ru',
    cost_method: 'wac',
    tax_mode: 'estimate',
    tax_rate_pct: 0,
    tax_base: 'revenue',
    default_min_stock: 5,
    export_format: 'csv',
    created_at: nowIso(),
    updated_at: nowIso(),
  }
}

export class LocalBackend implements Backend {
  readonly mode = 'local' as const
  private db: Db | null = null

  async getSessionUser(): Promise<SessionUser | null> {
    return LOCAL_USER
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.db))
    } catch {
      throw new Error('Не удалось сохранить данные: хранилище браузера переполнено или недоступно.')
    }
  }

  async loadAll(user: SessionUser): Promise<Db> {
    let db = emptyDb()
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) db = { ...emptyDb(), ...(JSON.parse(raw) as Partial<Db>) }
    } catch {
      /* повреждённые данные — начинаем с пустой базы */
    }
    if (!db.profile) db.profile = defaultProfile(user.id)
    this.db = db
    this.persist()
    return structuredClone(db)
  }

  private get state(): Db {
    if (!this.db) throw new Error('Хранилище не инициализировано')
    return this.db
  }

  async insert(table: TableName, rows: AnyRow[]): Promise<AnyRow[]> {
    const created = rows.map((r) => ({
      ...r,
      id: r.id ?? crypto.randomUUID(),
      user_id: LOCAL_USER.id,
      created_at: (r.created_at as string | undefined) ?? nowIso(),
      ...(table in UPDATED_AT_TABLES ? { updated_at: nowIso() } : {}),
    })) as AnyRow[]
    ;(this.state[table] as unknown as AnyRow[]).push(...created)
    this.persist()
    return structuredClone(created)
  }

  async update(table: TableName, id: string, patch: Record<string, unknown>): Promise<AnyRow> {
    const rows = this.state[table] as unknown as AnyRow[]
    const idx = rows.findIndex((r) => r.id === id)
    if (idx < 0) throw new Error('Запись не найдена')
    rows[idx] = {
      ...rows[idx],
      ...patch,
      ...(table in UPDATED_AT_TABLES ? { updated_at: nowIso() } : {}),
    }
    this.persist()
    return structuredClone(rows[idx])
  }

  async remove(table: TableName, ids: string[]): Promise<void> {
    const plan = planDelete(this.state, table, ids)
    if (plan.error) throw new Error(plan.error)
    const profile = this.state.profile
    this.db = applyPlan(this.state, plan)
    this.db.profile = profile
    this.persist()
  }

  async updateProfile(patch: Partial<Profile>): Promise<Profile> {
    const cur = this.state.profile ?? defaultProfile(LOCAL_USER.id)
    this.state.profile = { ...cur, ...patch, updated_at: nowIso() }
    this.persist()
    return structuredClone(this.state.profile)
  }

  async reset(): Promise<void> {
    const profile = this.state.profile
    this.db = { ...emptyDb(), profile }
    this.persist()
  }
}

const UPDATED_AT_TABLES: Record<string, true> = {
  categories: true,
  suppliers: true,
  products: true,
  purchase_batches: true,
  purchase_batch_items: true,
  expenses: true,
  sales: true,
  sale_items: true,
  product_evaluations: true,
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------
const PAGE = 1000

function explain(error: { message: string; code?: string }): Error {
  const map: Record<string, string> = {
    '23505': 'Запись с такими уникальными данными уже существует (дубликат SKU, номера партии или заказа).',
    '23503': 'Нельзя выполнить операцию: запись связана с другими данными.',
    '23514': 'Значение не прошло проверку ограничений базы данных.',
    '42501': 'Недостаточно прав доступа (проверьте вход в систему и политики RLS).',
  }
  return new Error(map[error.code ?? ''] ?? error.message)
}

export class SupabaseBackend implements Backend {
  readonly mode = 'supabase' as const
  private client = supabase!
  private workspaceOwnerId: string | null = null

  async getSessionUser(): Promise<SessionUser | null> {
    const { data } = await this.client.auth.getSession()
    const u = data.session?.user
    if (!u) return null
    return { id: u.id, email: u.email ?? '' }
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Неверный email или пароль.' : error.message)
  }

  async signUp(email: string, password: string, fullName: string): Promise<{ needsConfirmation: boolean }> {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    if (error) throw new Error(error.message)
    return { needsConfirmation: !data.session }
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut()
  }

  onAuthChange(cb: (user: SessionUser | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_e, session) => {
      const u = session?.user
      cb(u ? { id: u.id, email: u.email ?? '' } : null)
    })
    return () => data.subscription.unsubscribe()
  }

  private async fetchAll(table: TableName): Promise<AnyRow[]> {
    const out: AnyRow[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client
        .from(table)
        .select('*')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw explain(error)
      out.push(...((data ?? []) as AnyRow[]))
      if (!data || data.length < PAGE) break
    }
    return out
  }

  async loadAll(user: SessionUser): Promise<Db> {
    // Each member has their own login; all business rows belong to the owner.
    const membership = await this.client.from('workspace_members')
      .select('owner_id').eq('user_id', user.id).single()
    if (membership.error) throw explain(membership.error)
    this.workspaceOwnerId = membership.data.owner_id as string
    const db = emptyDb()
    const [profileRes, ...tables] = await Promise.all([
      this.client.from('profiles').select('*').eq('id', this.workspaceOwnerId).maybeSingle(),
      ...TABLE_NAMES.map((t) => this.fetchAll(t)),
    ])
    if (profileRes.error) throw explain(profileRes.error)
    let profile = profileRes.data as Profile | null
    if (!profile) {
      const ins = await this.client.from('profiles').insert({ id: this.workspaceOwnerId }).select('*').single()
      if (ins.error) throw explain(ins.error)
      profile = ins.data as Profile
    }
    db.profile = profile
    TABLE_NAMES.forEach((t, i) => {
      ;(db as unknown as Record<string, unknown>)[t] = tables[i]
    })
    return db
  }

  async insert(table: TableName, rows: AnyRow[]): Promise<AnyRow[]> {
    if (rows.length === 0) return []
    const payload = rows.map((r) => ({ ...r, user_id: this.workspaceOwnerId }))
    const out: AnyRow[] = []
    for (let i = 0; i < payload.length; i += 500) {
      const { data, error } = await this.client.from(table).insert(payload.slice(i, i + 500)).select('*')
      if (error) throw explain(error)
      out.push(...((data ?? []) as AnyRow[]))
    }
    return out
  }

  async update(table: TableName, id: string, patch: Record<string, unknown>): Promise<AnyRow> {
    const { data, error } = await this.client.from(table).update(patch).eq('id', id).select('*').single()
    if (error) throw explain(error)
    return data as AnyRow
  }

  async remove(table: TableName, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await this.client.from(table).delete().in('id', ids.slice(i, i + 200))
      if (error) throw explain(error)
    }
  }

  async updateProfile(patch: Partial<Profile>): Promise<Profile> {
    const { data, error } = await this.client.from('profiles').update(patch).eq('id', this.workspaceOwnerId!).select('*').single()
    if (error) throw explain(error)
    return data as Profile
  }
}

export function createBackend(): Backend {
  return supabase ? new SupabaseBackend() : new LocalBackend()
}

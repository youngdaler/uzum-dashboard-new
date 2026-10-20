import { useSyncExternalStore } from 'react'
import { createBackend, type AnyRow, type Backend, type SessionUser } from '@/data/backend'
import { applyPlan, planDelete } from '@/data/cascade'
import { ensureDefaults } from '@/data/seed'
import { derive, type Derived } from '@/lib/calc/derive'
import { emptyDb, type Db, type Profile, type TableName } from '@/types/db'

export type Status = 'booting' | 'signed_out' | 'loading' | 'ready' | 'error'

export interface AppState {
  status: Status
  error: string | null
  mode: 'supabase' | 'local'
  user: SessionUser | null
  db: Db
  version: number
}

const backend: Backend = createBackend()

let state: AppState = {
  status: 'booting',
  error: null,
  mode: backend.mode,
  user: null,
  db: emptyDb(),
  version: 0,
}
const listeners = new Set<() => void>()

function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch, version: patch.db ? state.version + 1 : state.version }
  listeners.forEach((l) => l())
}

let derivedCache: { version: number; value: Derived } | null = null

export function getState(): AppState {
  return state
}

export function getDerived(): Derived {
  if (!derivedCache || derivedCache.version !== state.version) {
    derivedCache = { version: state.version, value: derive(state.db) }
  }
  return derivedCache.value
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState)
}

export function useDb(): Db {
  return useSyncExternalStore(subscribe, () => state.db)
}

/** Производные показатели (партии, склад, финансы); пересчитываются только при изменении данных. */
export function useDerived(): Derived {
  useSyncExternalStore(subscribe, () => state.version)
  return getDerived()
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

async function loadFor(user: SessionUser): Promise<void> {
  set({ status: 'loading', user, error: null })
  try {
    let db = await backend.loadAll(user)
    const filled = await ensureDefaults(backend, db)
    db = filled
    set({ status: 'ready', db })
  } catch (e) {
    set({ status: 'error', error: message(e) })
  }
}

let booted = false
export async function boot(): Promise<void> {
  if (booted) return
  booted = true
  try {
    const user = await backend.getSessionUser()
    backend.onAuthChange?.((u) => {
      if (u && state.user?.id !== u.id) void loadFor(u)
      if (!u) set({ status: 'signed_out', user: null, db: emptyDb() })
    })
    if (!user) set({ status: 'signed_out' })
    else await loadFor(user)
  } catch (e) {
    set({ status: 'error', error: message(e) })
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  await backend.signIn?.(email, password)
}
export async function signUp(email: string, password: string, fullName: string) {
  return backend.signUp?.(email, password, fullName) ?? { needsConfirmation: false }
}
export async function signOut(): Promise<void> {
  await backend.signOut?.()
}

export async function refresh(): Promise<void> {
  if (state.user) await loadFor(state.user)
}

// Background sync: keep the app usable while polling other users' changes.
export async function syncSharedData(): Promise<void> {
  const user = state.user
  if (!user || state.status !== 'ready' || state.mode !== 'supabase') return
  try {
    const db = await backend.loadAll(user)
    if (state.user?.id === user.id && state.status === 'ready') set({ db })
  } catch (e) {
    console.warn('Не удалось синхронизировать данные:', e)
  }
}

// ---------------------------------------------------------------------------
// Мутации: запись в хранилище → обновление кэша. При ошибке бросают Error с понятным текстом.
// ---------------------------------------------------------------------------
type Row = { id: string } & Record<string, unknown>

export async function insertRows<T extends { id: string }>(table: TableName, rows: Partial<T>[]): Promise<T[]> {
  const withIds = rows.map((r) => ({ ...r, id: (r as Row).id ?? crypto.randomUUID() })) as AnyRow[]
  const created = (await backend.insert(table, withIds)) as unknown as T[]
  const cur = state.db[table] as unknown as Row[]
  set({ db: { ...state.db, [table]: [...cur, ...(created as unknown as Row[])] } })
  return created
}

export async function insertRow<T extends { id: string }>(table: TableName, row: Partial<T>): Promise<T> {
  return (await insertRows<T>(table, [row]))[0]
}

export async function updateRow<T extends { id: string }>(
  table: TableName,
  id: string,
  patch: Partial<T>,
): Promise<T> {
  const updated = (await backend.update(table, id, patch as Record<string, unknown>)) as unknown as T
  const cur = state.db[table] as unknown as Row[]
  set({
    db: { ...state.db, [table]: cur.map((r) => (r.id === id ? (updated as unknown as Row) : r)) },
  })
  return updated
}

export async function removeRows(table: TableName, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const plan = planDelete(state.db, table, ids)
  if (plan.error) throw new Error(plan.error)
  await backend.remove(table, ids)
  set({ db: applyPlan(state.db, plan) })
}

export async function updateProfile(patch: Partial<Profile>): Promise<void> {
  const profile = await backend.updateProfile(patch)
  set({ db: { ...state.db, profile } })
}

export async function resetLocalData(): Promise<void> {
  await backend.reset?.()
  await refresh()
}

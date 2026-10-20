import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AppShell } from '@/components/app-shell'
import { Loading, Notice } from '@/components/common'
import { Button } from '@/components/ui/button'
import { ConfirmProvider } from '@/components/ui/dialog'
import { boot, refresh, syncSharedData, useAppState } from '@/data/store'
import { useTheme } from '@/hooks/theme'
import { getLanguage } from '@/hooks/language'
import { initUiTranslation } from '@/lib/translate-ui'
import LoginPage from '@/pages/login'

const Dashboard = lazy(() => import('@/pages/dashboard'))
const Products = lazy(() => import('@/pages/products'))
const Batches = lazy(() => import('@/pages/batches'))
const BatchDetail = lazy(() => import('@/pages/batch-detail'))
const CalculatorPage = lazy(() => import('@/pages/calculator'))
const Sales = lazy(() => import('@/pages/sales'))
const Inventory = lazy(() => import('@/pages/inventory'))
const Expenses = lazy(() => import('@/pages/expenses'))
const Finance = lazy(() => import('@/pages/finance'))
const Analytics = lazy(() => import('@/pages/analytics'))
const Evaluation = lazy(() => import('@/pages/evaluation'))
const SettingsPage = lazy(() => import('@/pages/settings'))

function Gate() {
  const { status, error, mode } = useAppState()
  useEffect(() => {
    if (status !== 'ready' || mode !== 'supabase') return
    // Keep other users' saved changes visible without manual reload.
    let busy = false
    const sync = async () => {
      if (document.visibilityState !== 'visible' || busy) return
      busy = true
      try { await syncSharedData() } finally { busy = false }
    }
    const timer = window.setInterval(() => { void sync() }, 30000)
    const onVisible = () => { if (document.visibilityState === 'visible') void sync() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [status, mode])
  useEffect(() => {
    void boot()
  }, [])

  if (status === 'booting' || status === 'loading') return <Loading label="Загружаем данные…" />
  if (status === 'signed_out') return <LoginPage />
  if (status === 'error')
    return (
      <div className="mx-auto mt-24 max-w-md px-4">
        <Notice tone="danger">
          <p className="font-medium">Не удалось загрузить данные</p>
          <p className="mt-1 text-sm">{error}</p>
          <p className="mt-2 text-xs">Проверьте подключение к интернету и настройки Supabase (.env), что миграция из supabase/migrations применена.</p>
        </Notice>
        <Button className="mt-3" onClick={() => void refresh()}>
          Повторить
        </Button>
      </div>
    )

  return (
    <AppShell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/products" element={<Products />} />
          <Route path="/batches" element={<Batches />} />
          <Route path="/batches/:id" element={<BatchDetail />} />
          <Route path="/calculator" element={<CalculatorPage />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/evaluation" element={<Evaluation />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Notice tone="warning">Страница не найдена.</Notice>} />
        </Routes>
      </Suspense>
    </AppShell>
  )
}

export default function App() {
  const theme = useTheme()
  useEffect(() => {
    document.documentElement.lang = getLanguage() === 'uz' ? 'uz-Latn' : 'ru'
    const dispose = initUiTranslation(getLanguage)
    const refresh = () => document.body.setAttribute('data-translation-version', String(Date.now()))
    window.addEventListener('dashboard-language-refresh', refresh)
    return () => { dispose(); window.removeEventListener('dashboard-language-refresh', refresh) }
  }, [])
  return (
    <BrowserRouter>
      <ConfirmProvider>
        <Gate />
        <Toaster position="top-right" theme={theme} richColors closeButton />
      </ConfirmProvider>
    </BrowserRouter>
  )
}

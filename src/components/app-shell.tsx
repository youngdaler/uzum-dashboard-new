import {
  BarChart3,
  Boxes,
  Calculator,
  ClipboardCheck,
  Coins,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Sun,
  Truck,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/common'
import { signOut, useAppState } from '@/data/store'
import { toggleTheme, useTheme } from '@/hooks/theme'
import { t, type Key } from '@/lib/i18n'
import { useLanguage } from '@/hooks/language'
import { cn } from '@/lib/utils'

const NAV: { to: string; key: Key; icon: LucideIcon }[] = [
  { to: '/', key: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/products', key: 'nav.products', icon: Package },
  { to: '/batches', key: 'nav.batches', icon: Truck },
  { to: '/calculator', key: 'nav.calculator', icon: Calculator },
  { to: '/sales', key: 'nav.sales', icon: ShoppingCart },
  { to: '/inventory', key: 'nav.inventory', icon: Boxes },
  { to: '/expenses', key: 'nav.expenses', icon: Receipt },
  { to: '/finance', key: 'nav.finance', icon: Wallet },
  { to: '/analytics', key: 'nav.analytics', icon: BarChart3 },
  { to: '/evaluation', key: 'nav.evaluation', icon: ClipboardCheck },
  { to: '/settings', key: 'nav.settings', icon: Settings },
]

function Brand() {
  return (
    <div className="flex items-center gap-2 px-2">
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Coins className="size-4" />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold">Uzum Business</div>
        <div className="text-[11px] text-muted-foreground">Учёт закупок и продаж</div>
      </div>
    </div>
  )
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const [lang] = useLanguage()
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Основная навигация">
      {NAV.map(({ to, key, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-primary-soft text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )
          }
        >
          <Icon className="size-4" />
          {t(key, lang)}
        </NavLink>
      ))}
    </nav>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const theme = useTheme()
  const [lang, setLang] = useLanguage()
  const { mode, user } = useAppState()
  const loc = useLocation()
  const title = NAV.find((n) => (n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to)))

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-5 border-r bg-card px-3 py-4 lg:flex">
        <Brand />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavList />
        </div>
        <div className="border-t pt-3 text-xs text-muted-foreground">
          <div className="truncate px-2" title={user?.email}>
            {mode === 'local' ? 'Локальный режим (данные в браузере)' : user?.email}
          </div>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Меню">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col gap-5 bg-card px-3 py-4 shadow-xl">
            <div className="flex items-center justify-between">
              <Brand />
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Закрыть меню">
                <X />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <NavList onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Открыть меню">
            <Menu />
          </Button>
          <span className="text-sm font-medium text-muted-foreground lg:hidden">{title ? t(title.key,lang) : ''}</span>
          <div className="ml-auto flex items-center gap-1">
            <div className="flex items-center rounded-md border p-0.5" role="group" aria-label="Til / Язык" data-no-translate>
              <button type="button" onClick={() => setLang('ru')} aria-pressed={lang === 'ru'} className={`rounded px-2.5 py-1 text-xs font-semibold ${lang === 'ru' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>RU</button>
              <button type="button" onClick={() => setLang('uz')} aria-pressed={lang === 'uz'} className={`rounded px-2.5 py-1 text-xs font-semibold ${lang === 'uz' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>UZ</button>
            </div>
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
            {mode === 'supabase' && (
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                <LogOut /> Выйти
              </Button>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-5 sm:px-5">
          {mode === 'local' && (
            <Notice tone="primary" className="mb-4 text-xs">
              Работает локальный режим: данные сохраняются в этом браузере. Чтобы хранить их в Supabase и работать с нескольких устройств,
              укажите ключи в файле <code>.env</code> (см. README).
            </Notice>
          )}
          {children}
        </main>
      </div>
    </div>
  )
}

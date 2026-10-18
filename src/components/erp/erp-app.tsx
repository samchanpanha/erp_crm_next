'use client'

import { useEffect, useMemo, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import {
  LayoutDashboard, Building2, Target, FileText, ShoppingCart, FileSignature,
  Receipt, CreditCard, Landmark, Truck, PackageCheck, Package, Boxes,
  FolderKanban, Users, Palmtree, Wallet, LifeBuoy, BookOpen, CalendarDays,
  ChartColumn, Settings as SettingsIcon, Menu, Search, Plus, LogOut,
  ShieldCheck, Loader2, ChevronDown, House, Contact, TrendingUp,
  ShoppingBag, Warehouse, Briefcase, Headphones, SlidersHorizontal, Coffee,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { canView, canEdit } from '@/lib/permissions'
import { useAuthStore, type SessionUser } from '@/lib/auth-store'
import { authHeaders } from '@/components/erp/lib/session-token'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import AuthScreen from '@/components/erp/auth-screen'

const loadingFallback = () => (
  <div className="flex h-64 items-center justify-center gap-3 text-muted-foreground">
    <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    <span className="text-sm">Loading module…</span>
  </div>
)

interface NavItem { key: string; label: string; icon: LucideIcon }
interface NavGroup { group: string; icon: LucideIcon; items: NavItem[] }

/**
 * Sidebar menu tree: parent groups (collapsible) → child modules.
 * Group membership only affects navigation UI — permissions stay keyed by item.
 */
export const NAV: NavGroup[] = [
  {
    group: 'Home',
    icon: House,
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { key: 'reports', label: 'Reports', icon: ChartColumn },
      { key: 'agenda', label: 'Agenda', icon: CalendarDays },
    ],
  },
  {
    group: 'CRM & Sales',
    icon: Contact,
    items: [
      { key: 'third-parties', label: 'Third Parties', icon: Building2 },
      { key: 'opportunities', label: 'Opportunities', icon: Target },
      { key: 'proposals', label: 'Proposals', icon: FileText },
      { key: 'sale-orders', label: 'Sale Orders', icon: ShoppingCart },
      { key: 'contracts', label: 'Contracts', icon: FileSignature },
    ],
  },
  {
    group: 'Billing & Finance',
    icon: Wallet,
    items: [
      { key: 'invoices', label: 'Invoices', icon: Receipt },
      { key: 'payments', label: 'Payments', icon: CreditCard },
      { key: 'bank', label: 'Bank & Cash', icon: Landmark },
    ],
  },
  {
    group: 'Purchasing',
    icon: ShoppingBag,
    items: [
      { key: 'purchase-orders', label: 'Supplier Orders', icon: Truck },
      { key: 'supplier-invoices', label: 'Supplier Invoices', icon: PackageCheck },
    ],
  },
  {
    group: 'Products & Stock',
    icon: Warehouse,
    items: [
      { key: 'products', label: 'Products & Services', icon: Package },
      { key: 'stock', label: 'Stock & Warehouses', icon: Boxes },
    ],
  },
  {
    group: 'Projects',
    icon: FolderKanban,
    items: [{ key: 'projects', label: 'Projects & Tasks', icon: FolderKanban }],
  },
  {
    group: 'HR',
    icon: Briefcase,
    items: [
      { key: 'employees', label: 'Employees', icon: Users },
      { key: 'leave', label: 'Leave Requests', icon: Palmtree },
      { key: 'expenses', label: 'Expense Reports', icon: Wallet },
    ],
  },
  {
    group: 'Support',
    icon: Headphones,
    items: [
      { key: 'tickets', label: 'Tickets', icon: LifeBuoy },
      { key: 'knowledge', label: 'Knowledge Base', icon: BookOpen },
    ],
  },
  {
    group: 'Configuration',
    icon: SlidersHorizontal,
    items: [
      { key: 'settings', label: 'Settings', icon: SettingsIcon },
      { key: 'users', label: 'Users & Roles', icon: ShieldCheck },
    ],
  },
  {
    group: 'Coffee',
    icon: Coffee,
    items: [{ key: 'coffee', label: 'Buy Me a Coffee', icon: Coffee }],
  },
]

/** Nav key → permission module (dashboard has no entry: always visible) */
const NAV_PERMISSIONS: Record<string, string> = {
  reports: 'reports', 'third-parties': 'thirdparties', opportunities: 'opportunities',
  proposals: 'proposals', 'sale-orders': 'saleorders', contracts: 'contracts',
  invoices: 'invoices', payments: 'payments', bank: 'bank',
  'purchase-orders': 'purchaseorders', 'supplier-invoices': 'supplierinvoices',
  products: 'products', stock: 'stock', projects: 'projects',
  employees: 'employees', leave: 'leave', expenses: 'expenses',
  tickets: 'tickets', knowledge: 'knowledge', agenda: 'agenda',
  settings: 'settings', users: 'administration', coffee: 'coffee',
}

/** Quick-create entries, gated by the target module's .edit permission */
const QUICK_CREATE_ITEMS: { key: string; label: string; module: string }[] = [
  { key: 'third-parties', label: 'Third party / contact', module: 'thirdparties' },
  { key: 'proposals', label: 'Commercial proposal', module: 'proposals' },
  { key: 'sale-orders', label: 'Sale order', module: 'saleorders' },
  { key: 'invoices', label: 'Customer invoice', module: 'invoices' },
  { key: 'products', label: 'Product / service', module: 'products' },
  { key: 'tickets', label: 'Support ticket', module: 'tickets' },
  { key: 'projects', label: 'Project', module: 'projects' },
  { key: 'agenda', label: 'Agenda event', module: 'agenda' },
]

/** Lazily loaded module views (files created incrementally per module agent) */
const MODULE_VIEWS: Record<string, React.ComponentType> = {
  dashboard: dynamic(() => import('./modules/dashboard'), { ssr: false, loading: loadingFallback }),
  'third-parties': dynamic(() => import('./modules/third-parties'), { ssr: false, loading: loadingFallback }),
  opportunities: dynamic(() => import('./modules/opportunities'), { ssr: false, loading: loadingFallback }),
  proposals: dynamic(() => import('./modules/proposals'), { ssr: false, loading: loadingFallback }),
  'sale-orders': dynamic(() => import('./modules/sale-orders'), { ssr: false, loading: loadingFallback }),
  contracts: dynamic(() => import('./modules/contracts'), { ssr: false, loading: loadingFallback }),
  invoices: dynamic(() => import('./modules/invoices'), { ssr: false, loading: loadingFallback }),
  payments: dynamic(() => import('./modules/payments'), { ssr: false, loading: loadingFallback }),
  bank: dynamic(() => import('./modules/bank'), { ssr: false, loading: loadingFallback }),
  'purchase-orders': dynamic(() => import('./modules/purchase-orders'), { ssr: false, loading: loadingFallback }),
  'supplier-invoices': dynamic(() => import('./modules/supplier-invoices'), { ssr: false, loading: loadingFallback }),
  products: dynamic(() => import('./modules/products'), { ssr: false, loading: loadingFallback }),
  stock: dynamic(() => import('./modules/stock'), { ssr: false, loading: loadingFallback }),
  projects: dynamic(() => import('./modules/projects'), { ssr: false, loading: loadingFallback }),
  employees: dynamic(() => import('./modules/employees'), { ssr: false, loading: loadingFallback }),
  leave: dynamic(() => import('./modules/leave'), { ssr: false, loading: loadingFallback }),
  expenses: dynamic(() => import('./modules/expenses'), { ssr: false, loading: loadingFallback }),
  tickets: dynamic(() => import('./modules/tickets'), { ssr: false, loading: loadingFallback }),
  knowledge: dynamic(() => import('./modules/knowledge'), { ssr: false, loading: loadingFallback }),
  agenda: dynamic(() => import('./modules/agenda'), { ssr: false, loading: loadingFallback }),
  reports: dynamic(() => import('./modules/reports'), { ssr: false, loading: loadingFallback }),
  settings: dynamic(() => import('./modules/settings'), { ssr: false, loading: loadingFallback }),
  users: dynamic(() => import('./modules/users'), { ssr: false, loading: loadingFallback }),
  coffee: dynamic(() => import('./modules/coffee'), { ssr: false, loading: loadingFallback }),
}

/** Keep only nav items the user may view; drop groups that become empty. */
function filterNav(user: SessionUser): NavGroup[] {
  return NAV
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        const moduleName = NAV_PERMISSIONS[item.key]
        return !moduleName || canView(user.permissions, moduleName)
      }),
    }))
    .filter((g) => g.items.length > 0)
}

function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  const chars = parts.map((p) => p[0]?.toUpperCase() ?? '').join('')
  return chars || 'U'
}

function useHashRoute(allowed: Set<string>): string {
  const [route, setRoute] = useState('dashboard')
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.replace(/^#\/?/, '') || 'dashboard'
      // Hidden (permission-gated) or unknown modules fall back to the dashboard
      setRoute(h in MODULE_VIEWS && allowed.has(h) ? h : 'dashboard')
    }
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [allowed])
  return route
}

function navigate(key: string) {
  window.location.hash = `#/${key}`
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary font-black text-primary-foreground shadow-sm">
        DN
      </div>
      <div className="leading-tight">
        <p className="text-sm font-bold tracking-tight">DoliNext</p>
        <p className="text-[11px] text-muted-foreground">ERP &amp; CRM</p>
      </div>
    </div>
  )
}

/** localStorage key persisting which sidebar groups are expanded */
const NAV_OPEN_KEY = 'dolinext_nav_open'

function readOpenGroups(): Set<string> {
  try {
    const raw = window.localStorage.getItem(NAV_OPEN_KEY)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {
    // storage blocked — fall through to empty set
  }
  return new Set()
}

function persistOpenGroups(groups: Set<string>) {
  try {
    window.localStorage.setItem(NAV_OPEN_KEY, JSON.stringify([...groups]))
  } catch {
    // storage blocked — state still lives for this mount
  }
}

function groupSlug(group: string): string {
  return `nav-group-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

/**
 * Sidebar menu: parent groups (collapsible) → child module links.
 * Open/closed state persists in localStorage; the group holding the active
 * route is always expanded, and its parent shows a subtle active hint while
 * collapsed so users never lose their place.
 */
function SidebarContent({ current, nav }: { current: string; nav: NavGroup[] }) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const stored = readOpenGroups()
    if (stored.size > 0) return stored
    // First visit: expand the active group (falls back to Home).
    const activeGroup = nav.find((g) => g.items.some((i) => i.key === current))?.group
    return new Set([activeGroup ?? 'Home'])
  })

  // Keep the active route's group expanded (also covers search/quick-create jumps).
  // Derived-state adjustment during render — the React-recommended pattern.
  const [prevCurrent, setPrevCurrent] = useState(current)
  if (prevCurrent !== current) {
    setPrevCurrent(current)
    const group = nav.find((g) => g.items.some((i) => i.key === current))?.group
    if (group && !openGroups.has(group)) {
      const next = new Set(openGroups)
      next.add(group)
      persistOpenGroups(next)
      setOpenGroups(next)
    }
  }

  function toggleGroup(group: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      persistOpenGroups(next)
      return next
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-4">
        <Logo />
      </div>
      <ScrollArea className="flex-1 px-2 pb-4">
        <nav aria-label="ERP modules" className="space-y-0.5">
          {nav.map((g) => {
            const open = openGroups.has(g.group)
            const activeChild = g.items.some((i) => i.key === current)
            return (
              <div key={g.group}>
                <button
                  type="button"
                  onClick={() => toggleGroup(g.group)}
                  aria-expanded={open}
                  aria-controls={groupSlug(g.group)}
                  className={cn(
                    'mt-1 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    activeChild && !open
                      ? 'text-foreground'
                      : 'text-foreground/75',
                  )}
                >
                  <g.icon
                    className={cn(
                      'h-4 w-4 shrink-0',
                      activeChild ? 'text-primary' : 'text-muted-foreground',
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate text-left">{g.group}</span>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                      open && 'rotate-180',
                    )}
                    aria-hidden="true"
                  />
                </button>
                {open && (
                  <ul id={groupSlug(g.group)} className="ml-[26px] mt-0.5 space-y-0.5 border-l pl-2">
                    {g.items.map((item) => {
                      const active = current === item.key
                      return (
                        <li key={item.key}>
                          <button
                            type="button"
                            onClick={() => navigate(item.key)}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                              'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                              active
                                ? 'bg-primary font-medium text-primary-foreground shadow-sm'
                                : 'text-foreground/80 hover:bg-accent hover:text-foreground',
                            )}
                          >
                            <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                            <span className="truncate">{item.label}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </nav>
      </ScrollArea>
      <div className="border-t px-4 py-3 text-[11px] text-muted-foreground">
        Rebuilt from dolibarr.org · v1.0
      </div>
    </div>
  )
}

function AccountMenu({ user }: { user: SessionUser }) {
  const logout = useAuthStore((s) => s.logout)
  const [signingOut, setSigningOut] = useState(false)
  const can = (module: string) => canView(user.permissions, module)

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    await logout()
    setSigningOut(false)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full outline-none ring-primary focus-visible:ring-2" aria-label="Account menu">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
              {userInitials(user.name)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col">
            <span className="text-sm font-semibold">{user.name}</span>
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            <span className="mt-1 truncate text-[11px] text-muted-foreground">
              {user.role?.name ?? 'No role'} · {user.tenant.name}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {can('agenda') && (
          <DropdownMenuItem onClick={() => navigate('agenda')}>
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            My agenda
          </DropdownMenuItem>
        )}
        {can('employees') && (
          <DropdownMenuItem onClick={() => navigate('employees')}>
            <Users className="h-4 w-4" aria-hidden="true" />
            My HR space
          </DropdownMenuItem>
        )}
        {can('settings') && (
          <DropdownMenuItem onClick={() => navigate('settings')}>
            <SettingsIcon className="h-4 w-4" aria-hidden="true" />
            Settings
          </DropdownMenuItem>
        )}
        {can('administration') && (
          <DropdownMenuItem onClick={() => navigate('users')}>
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Users &amp; Roles
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signingOut}
          onClick={() => void handleSignOut()}
          aria-busy={signingOut}
        >
          {signingOut
            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            : <LogOut className="h-4 w-4" aria-hidden="true" />}
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TopBar({
  user, nav, quickCreateItems, onOpenMobileNav,
}: {
  user: SessionUser
  nav: NavGroup[]
  quickCreateItems: { key: string; label: string }[]
  onOpenMobileNav: () => void
}) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    return nav
      .flatMap((g) => g.items.filter((i) => i.label.toLowerCase().includes(q)).map((i) => i))
      .slice(0, 6)
  }, [query, nav])

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMobileNav} aria-label="Open navigation">
        <Menu className="h-5 w-5" />
      </Button>

      <div className="relative hidden sm:block w-72 md:w-80">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search modules…"
          className="pl-8 h-9"
          aria-label="Search modules"
        />
        {results.length > 0 && (
          <div className="absolute top-full z-40 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
            {results.map((r) => (
              <button
                key={r.key}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                onClick={() => { navigate(r.key); setQuery('') }}
              >
                <r.icon className="h-4 w-4 text-muted-foreground" />
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {quickCreateItems.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-9 gap-1.5">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Quick create</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>New record</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {quickCreateItems.map((item) => (
                <DropdownMenuItem key={item.key} onClick={() => navigate(item.key)}>
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <AccountMenu user={user} />
      </div>
    </header>
  )
}

function ModulePlaceholder({ current }: { current: string }) {
  const item = NAV.flatMap((g) => g.items).find((i) => i.key === current)
  return (
    <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
      <p className="font-medium text-foreground">{item?.label ?? current}</p>
      <p className="mt-1 text-sm">This module is being rebuilt — check back shortly.</p>
    </div>
  )
}

/** Signed-in ERP shell (remounted per user via key={user.id} → fresh QueryClient) */
function ErpApp({ user }: { user: SessionUser }) {
  const nav = useMemo(() => filterNav(user), [user])
  const allowedKeys = useMemo(
    () => new Set(nav.flatMap((g) => g.items.map((i) => i.key))),
    [nav],
  )
  const route = useHashRoute(allowedKeys)
  const quickCreateItems = useMemo(
    () => QUICK_CREATE_ITEMS.filter((i) => canEdit(user.permissions, i.module)),
    [user],
  )
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const queryClient = useMemo(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
  }), [])
  const View = MODULE_VIEWS[route]

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen bg-muted/40">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block w-60 shrink-0 border-r bg-background">
            <div className="sticky top-0 h-screen">
              <SidebarContent current={route} nav={nav} />
            </div>
          </aside>

          {/* Mobile sidebar */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <span className="hidden" aria-hidden="true" />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">ERP module menu grouped by category</SheetDescription>
              <SidebarContent current={route} nav={nav} />
            </SheetContent>
          </Sheet>

          {/* Main column */}
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar
              user={user}
              nav={nav}
              quickCreateItems={quickCreateItems}
              onOpenMobileNav={() => setMobileNavOpen(true)}
            />
            <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
              <div className="mx-auto w-full max-w-7xl">
                {View ? <View /> : <ModulePlaceholder current={route} />}
              </div>
            </main>
            <footer className="mt-auto border-t bg-background px-4 py-3 text-center text-xs text-muted-foreground sm:px-6">
              DoliNext ERP &amp; CRM — an open rebuild of the Dolibarr feature set ·
              CRM · Sales · Purchasing · Stock · Finance · Projects · HR · Support
              {' · '}{user.tenant.name}
            </footer>
          </div>
        </div>
    </QueryClientProvider>
  )
}

/** Centered splash while the session is being restored */
function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background" role="status" aria-live="polite">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary font-black text-primary-foreground shadow-sm">
        DN
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
        <span className="text-sm">Loading your workspace…</span>
      </div>
    </div>
  )
}

/**
 * Default export — the auth-aware root.
 * loading → splash · anon → AuthScreen · authed → ErpApp (fresh per user).
 */
export default function ErpRoot() {
  const status = useAuthStore((s) => s.status)
  const user = useAuthStore((s) => s.user)
  const init = useAuthStore((s) => s.init)
  const forceSignOut = useAuthStore((s) => s.forceSignOut)

  // Restore the session once on mount
  useEffect(() => {
    void init()
  }, [init])

  // Session watchdog: immediate check + every 60s + on focus/visibility.
  // Silent while authed — only a 401 drops the local session.
  useEffect(() => {
    if (status !== 'authed') return
    let alive = true
    const check = async () => {
      try {
        const res = await fetch('/api/auth/me', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: authHeaders(),
        })
        if (alive && res.status === 401) {
          forceSignOut()
          window.location.hash = '#/dashboard'
        }
      } catch {
        // network hiccup — keep the current session state
      }
    }
    void check()
    const id = window.setInterval(() => { void check() }, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearInterval(id)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [status, forceSignOut])

  if (status === 'loading') return <Splash />
  if (status === 'anon' || !user) return <AuthScreen />
  return <ErpApp key={user.id} user={user} />
}

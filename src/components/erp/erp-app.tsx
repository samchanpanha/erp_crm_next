'use client'

import { useEffect, useMemo, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import {
  LayoutDashboard, Building2, Target, FileText, ShoppingCart, FileSignature,
  Receipt, CreditCard, Landmark, Truck, PackageCheck, Package, Boxes,
  FolderKanban, Users, Palmtree, Wallet, LifeBuoy, BookOpen, CalendarDays,
  Menu, Search, Plus, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

const loadingFallback = () => (
  <div className="flex h-64 items-center justify-center gap-3 text-muted-foreground">
    <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    <span className="text-sm">Loading module…</span>
  </div>
)

interface NavItem { key: string; label: string; icon: LucideIcon }
interface NavGroup { group: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { group: 'Home', items: [{ key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    group: 'CRM & Sales',
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
    items: [
      { key: 'invoices', label: 'Invoices', icon: Receipt },
      { key: 'payments', label: 'Payments', icon: CreditCard },
      { key: 'bank', label: 'Bank & Cash', icon: Landmark },
    ],
  },
  {
    group: 'Purchasing',
    items: [
      { key: 'purchase-orders', label: 'Supplier Orders', icon: Truck },
      { key: 'supplier-invoices', label: 'Supplier Invoices', icon: PackageCheck },
    ],
  },
  {
    group: 'Products & Stock',
    items: [
      { key: 'products', label: 'Products & Services', icon: Package },
      { key: 'stock', label: 'Stock & Warehouses', icon: Boxes },
    ],
  },
  { group: 'Projects', items: [{ key: 'projects', label: 'Projects & Tasks', icon: FolderKanban }] },
  {
    group: 'HR',
    items: [
      { key: 'employees', label: 'Employees', icon: Users },
      { key: 'leave', label: 'Leave Requests', icon: Palmtree },
      { key: 'expenses', label: 'Expense Reports', icon: Wallet },
    ],
  },
  {
    group: 'Support',
    items: [
      { key: 'tickets', label: 'Tickets', icon: LifeBuoy },
      { key: 'knowledge', label: 'Knowledge Base', icon: BookOpen },
    ],
  },
  { group: 'Productivity', items: [{ key: 'agenda', label: 'Agenda', icon: CalendarDays }] },
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
}

function useHashRoute(): string {
  const [route, setRoute] = useState('dashboard')
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.replace(/^#\/?/, '') || 'dashboard'
      setRoute(h in MODULE_VIEWS ? h : 'dashboard')
    }
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
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

function SidebarContent({ current }: { current: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-4">
        <Logo />
      </div>
      <ScrollArea className="flex-1 px-2 pb-4">
        <nav aria-label="ERP modules" className="space-y-4">
          {NAV.map((g) => (
            <div key={g.group}>
              <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {g.group}
              </p>
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const active = current === item.key
                  return (
                    <li key={item.key}>
                      <button
                        onClick={() => navigate(item.key)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                          active
                            ? 'bg-primary text-primary-foreground font-medium shadow-sm'
                            : 'text-foreground/80 hover:bg-accent hover:text-foreground'
                        )}
                      >
                        <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </ScrollArea>
      <div className="border-t px-4 py-3 text-[11px] text-muted-foreground">
        Rebuilt from dolibarr.org · v1.0
      </div>
    </div>
  )
}

function TopBar({ current, onOpenMobileNav }: { current: string; onOpenMobileNav: () => void }) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    return NAV.flatMap((g) => g.items.filter((i) => i.label.toLowerCase().includes(q)).map((i) => i)).slice(0, 6)
  }, [query])

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
            <DropdownMenuItem onClick={() => navigate('third-parties')}>Third party / contact</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('proposals')}>Commercial proposal</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('sale-orders')}>Sale order</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('invoices')}>Customer invoice</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('products')}>Product / service</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('tickets')}>Support ticket</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('projects')}>Project</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('agenda')}>Agenda event</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-full outline-none ring-primary focus-visible:ring-2" aria-label="Account menu">
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">AM</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Alice Martin</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('employees')}>My HR space</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('agenda')}>My agenda</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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

export default function ErpApp() {
  const route = useHashRoute()
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
              <SidebarContent current={route} />
            </div>
          </aside>

          {/* Mobile sidebar */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <span className="hidden" aria-hidden="true" />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarContent current={route} />
            </SheetContent>
          </Sheet>

          {/* Main column */}
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar current={route} onOpenMobileNav={() => setMobileNavOpen(true)} />
            <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
              <div className="mx-auto w-full max-w-7xl">
                {View ? <View /> : <ModulePlaceholder current={route} />}
              </div>
            </main>
            <footer className="mt-auto border-t bg-background px-4 py-3 text-center text-xs text-muted-foreground sm:px-6">
              DoliNext ERP &amp; CRM — an open rebuild of the Dolibarr feature set ·
              CRM · Sales · Purchasing · Stock · Finance · Projects · HR · Support
            </footer>
          </div>
        </div>
    </QueryClientProvider>
  )
}

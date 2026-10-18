'use client'

import { useQuery } from '@tanstack/react-query'
import {
  Users, Package, FileText, ShoppingCart, Receipt, Landmark, LifeBuoy,
  Boxes, FolderKanban, Palmtree, CalendarDays, ArrowRight, TriangleAlert,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip as ReTooltip, XAxis, YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { get } from '@/components/erp/lib/api'
import { useAuthStore } from '@/lib/auth-store'
import { StatCard } from '@/components/erp/shared/stat-card'
import { DocStatusBadge, PriorityBadge } from '@/components/erp/shared/status-badge'
import { formatMoney, formatDate, relativeDays } from '@/components/erp/shared/format'
import { navigate } from '@/components/erp/lib/nav'

interface DashData {
  kpis: {
    thirdPartyCount: number
    productCount: number
    openProposalCount: number
    openOrderCount: number
    unpaidTotal: number
    unpaidCount: number
    overdueCount: number
    paidTotal: number
    lowStockCount: number
    openTickets: number
    pendingLeaves: number
    activeProjects: number
    bankBalance: number
  }
  lowStock: { ref: string; label: string; stockQty: number; minStock: number; unit: string }[]
  unpaid: { ref: string; thirdParty: string; remaining: number; dueDate: string | null }[]
  series: { month: string; revenue: number; expenses: number }[]
  invoiceStatusCounts: { status: string; count: number }[]
  opportunitiesByStage: { stage: string; count: number; amount: number }[]
  recentInvoices: { id: string; ref: string; status: string; date: string; total: number; paidAmount: number; thirdParty: { name: string } }[]
  recentTickets: { id: string; ref: string; subject: string; status: string; priority: string; createdAt: string; thirdParty: { name: string } | null }[]
  upcomingEvents: { id: string; title: string; type: string; start: string; thirdParty: { name: string } | null }[]
}

const PIE_COLORS = ['#16a34a', '#f59e0b', '#ea580c', '#a1a1aa', '#e11d48']

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', UNPAID: 'Unpaid', PARTIAL: 'Partial', PAID: 'Paid', CANCELLED: 'Cancelled',
}

export default function Dashboard() {
  const { data, isLoading, error } = useQuery<DashData>({
    queryKey: ['dashboard'],
    queryFn: () => get<DashData>('/api/dashboard'),
  })

  const authUser = useAuthStore((s) => s.user)

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-rose-600">Failed to load dashboard: {(error as Error).message}</CardContent>
      </Card>
    )
  }

  const firstName = authUser?.name?.trim().split(/\s+/)[0] ?? 'there'

  const k = data?.kpis
  const pieData = (data?.invoiceStatusCounts ?? []).map((s) => ({
    name: STATUS_LABEL[s.status] ?? s.status,
    value: s.count,
  }))

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Welcome back, {firstName} 👋</h1>
        <p className="text-sm text-muted-foreground">
          Here is what happens across your business today.
        </p>
      </div>

      {/* KPI row 1 — money */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {isLoading || !k ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)
        ) : (
          <>
            <StatCard title="Collected payments" value={k.paidTotal} isMoney hint="All customer payments" icon={Receipt} tone="success" />
            <StatCard title="Outstanding invoices" value={k.unpaidTotal} isMoney hint={`${k.unpaidCount} unpaid · ${k.overdueCount} overdue`} icon={Receipt} tone={k.overdueCount > 0 ? 'warning' : 'default'} />
            <StatCard title="Bank & cash balance" value={k.bankBalance} isMoney hint="Across all accounts" icon={Landmark} />
            <StatCard title="Open opportunity value" value={(data?.opportunitiesByStage ?? []).filter((o) => !['WON', 'LOST'].includes(o.stage)).reduce((s, o) => s + o.amount, 0)} isMoney hint="Pipeline weighted by stage" icon={FileText} />
          </>
        )}
      </div>

      {/* KPI row 2 — operations */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
        {isLoading || !k ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)
        ) : (
          <>
            <StatCard title="Third parties" value={k.thirdPartyCount} icon={Users} hint="Customers, prospects, suppliers" />
            <StatCard title="Open proposals" value={k.openProposalCount} icon={FileText} hint="Draft or validated" />
            <StatCard title="Sale orders" value={k.openOrderCount} icon={ShoppingCart} hint="Not yet billed" />
            <StatCard title="Open tickets" value={k.openTickets} icon={LifeBuoy} tone={k.openTickets > 3 ? 'warning' : 'default'} hint="Help desk queue" />
            <StatCard title="Low stock items" value={k.lowStockCount} icon={Boxes} tone={k.lowStockCount > 0 ? 'danger' : 'default'} hint="At or below minimum" />
            <StatCard title="Active projects" value={k.activeProjects} icon={FolderKanban} hint={`${k.pendingLeaves} leave approvals pending`} />
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revenue vs purchases — last 6 months</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data!.series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} width={56} tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                  <ReTooltip formatter={(value) => formatMoney(Number(value))} />
                  <Bar dataKey="revenue" name="Revenue" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="Purchases" fill="#ea580c" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Invoices by status</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : pieData.length === 0 ? (
              <p className="pt-16 text-center text-sm text-muted-foreground">No invoices yet</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <ReTooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="mt-2 flex flex-wrap justify-center gap-3">
              {pieData.map((d, i) => (
                <span key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  {d.name} ({d.value})
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Watchlists */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" /> Unpaid invoices
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('invoices')}>
              All <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
            ) : (data?.unpaid.length ?? 0) === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Everything is paid 🎉</p>
            ) : (
              data!.unpaid.map((i) => (
                <div key={i.ref} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{i.ref} · {i.thirdParty}</p>
                    <p className="text-xs text-muted-foreground">Due {relativeDays(i.dueDate)}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(i.remaining)}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TriangleAlert className="h-4 w-4 text-amber-500" /> Low stock alerts
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('stock')}>
              Stock <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
            ) : (data?.lowStock.length ?? 0) === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">All stock levels are healthy</p>
            ) : (
              data!.lowStock.map((p) => (
                <div key={p.ref} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.label}</p>
                    <p className="text-xs text-muted-foreground">{p.ref} · min {p.minStock} {p.unit}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 tabular-nums">
                    {p.stockQty} left
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" /> Upcoming agenda
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('agenda')}>
              Agenda <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
            ) : (data?.upcomingEvents.length ?? 0) === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nothing scheduled</p>
            ) : (
              data!.upcomingEvents.map((e) => (
                <div key={e.id} className="rounded-lg border p-2.5">
                  <p className="truncate text-sm font-medium">{e.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.type.replaceAll('_', ' ')} · {formatDate(e.start)} · {relativeDays(e.start)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Latest invoices</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="mb-2 h-10 w-full" />)
            ) : (
              <div className="divide-y">
                {data?.recentInvoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{inv.ref} — {inv.thirdParty.name}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(inv.date)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums">{formatMoney(inv.total)}</span>
                      <DocStatusBadge status={inv.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Latest tickets</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="mb-2 h-10 w-full" />)
            ) : (
              <div className="divide-y">
                {data?.recentTickets.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{t.ref} — {t.subject}</p>
                      <p className="text-xs text-muted-foreground">{t.thirdParty?.name ?? 'Internal'} · {formatDate(t.createdAt)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <PriorityBadge priority={t.priority} />
                      <DocStatusBadge status={t.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

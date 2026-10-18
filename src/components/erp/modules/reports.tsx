'use client'

/**
 * Reports module — sales, receivables aging, payables aging, top lists,
 * VAT summary and inventory valuation. Read-only insight views, each with
 * client-side CSV export and browser print support (.print-area/.printing-doc).
 */

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { authHeaders } from '@/components/erp/lib/session-token'
import {
  Boxes,
  ChartColumn,
  CircleCheck,
  Download,
  HandCoins,
  Package,
  Printer,
  Receipt,
  TriangleAlert,
  TrendingUp,
  Users,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { get } from '../lib/api'
import { EmptyState, PageHeader } from '../shared/page-header'
import { DocStatusBadge } from '../shared/status-badge'
import { StatCard } from '../shared/stat-card'
import { formatDate, formatMoney, toDateInput } from '../shared/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ---------------------------------------------------------------------------
// Types (mirrors of the /api/reports/* contracts)
// ---------------------------------------------------------------------------
interface SalesData {
  window: { from: string; to: string }
  series: { month: string; revenue: number; collected: number }[]
  totals: { revenue: number; collected: number; outstanding: number }
  statusBreakdown: { status: string; count: number; total: number }[]
}

interface AgingRow {
  id: string
  ref: string
  status: string
  customer?: { name: string; code: string }
  supplier?: { name: string; code: string }
  date: string
  dueDate: string | null
  total: number
  paidAmount: number
  dueAmount: number
  daysOverdue: number
  bucket: string
}

interface AgingData {
  rows: AgingRow[]
  summary: { bucket: string; count: number; amount: number }[]
  totals: { totalDue: number; overdueAmount: number }
  asOf: string
}

interface TopCustomerRow {
  id: string
  name: string
  code: string
  invoiceCount: number
  revenue: number
  paid: number
}

interface TopProductRow {
  id: string
  ref: string
  label: string
  qty: number
  amount: number
}

interface TopData {
  type: 'customers' | 'products'
  window: { from: string; to: string }
  rows: TopCustomerRow[] | TopProductRow[]
  total: number
}

interface TaxData {
  window: { from: string; to: string }
  rows: { rate: number; net: number; vat: number }[]
  totals: { net: number; vat: number }
}

interface InventoryData {
  rows: {
    id: string
    ref: string
    label: string
    stockQty: number
    minStock: number
    costPrice: number
    stockValue: number
    low: boolean
  }[]
  totals: { totalValue: number; lowCount: number; productCount: number }
  asOf: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const STALE_TIME = 30_000
const RANGE_TABS = new Set(['sales', 'top', 'tax'])

/** Isolate the .print-area and print, then clean the body class afterwards. */
function printNow() {
  document.body.classList.add('printing-doc')
  window.print()
  window.addEventListener(
    'afterprint',
    () => document.body.classList.remove('printing-doc'),
    { once: true }
  )
}

/** Download report-<tab>-YYYYMMDD.xlsx generated server-side (styled workbook). */
async function exportXlsx(tab: string, headers: string[], rows: Record<string, unknown>[]) {
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const res = await fetch('/api/export/xlsx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      filename: `report-${tab}-${stamp}.xlsx`,
      sheetName: tab.charAt(0).toUpperCase() + tab.slice(1),
      headers,
      rows,
    }),
  })
  if (!res.ok) throw new Error('Export failed')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `report-${tab}-${stamp}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** '2026-10' → 'Oct 26' for chart axes. */
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

/** 'Mar 1, 2026 – Oct 18, 2026' subtitle for print headings. */
function periodLabel(win?: { from: string; to: string }): string {
  if (!win) return ''
  return `${formatDate(win.from)} – ${formatDate(win.to)}`
}

/** Share of the window total, 1 decimal, as a plain string ('' when n/a). */
function sharePct(amount: number, total: number): string {
  return total > 0 ? ((amount / total) * 100).toFixed(1) : ''
}

const BUCKET_LABEL: Record<string, string> = {
  CURRENT: 'Current',
  '1-30': '1–30 days',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '90+': '90+ days',
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------
function ReportToolbar({ onExport }: { onExport: () => void }) {
  return (
    <div className="no-print flex flex-wrap items-center justify-end gap-2">
      <Button variant="outline" size="sm" onClick={onExport}>
        <Download className="h-4 w-4" aria-hidden="true" /> Export Excel
      </Button>
      <Button variant="outline" size="sm" onClick={printNow}>
        <Printer className="h-4 w-4" aria-hidden="true" /> Print
      </Button>
    </div>
  )
}

/** Title only visible on paper (the on-screen header stays outside the print area). */
function PrintHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="hidden print:block">
      <h2 className="text-lg font-bold">{title}</h2>
      {subtitle ? <p className="text-sm">{subtitle}</p> : null}
    </div>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="p-6 text-sm text-rose-600">
        Failed to load report: {message}
      </CardContent>
    </Card>
  )
}

function StatSkeletons({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[104px] rounded-xl" />
      ))}
    </>
  )
}

function RowSkeletons({ rows, cols }: { rows: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          <TableCell colSpan={cols}>
            <Skeleton className="h-8 w-full" />
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------
function SalesTab({ from, to }: { from: string; to: string }) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const search = params.toString()

  const { data, isLoading, error } = useQuery<SalesData>({
    queryKey: ['reports-sales', from, to],
    queryFn: () => get<SalesData>(`/api/reports/sales${search ? `?${search}` : ''}`),
    staleTime: STALE_TIME,
  })

  const handleExport = () => {
    if (!data) return
    exportXlsx(
      'sales',
      ['Month', 'Revenue', 'Collected'],
      [
        ...data.series.map((s) => ({ Month: s.month, Revenue: s.revenue, Collected: s.collected })),
        { Month: 'TOTAL', Revenue: data.totals.revenue, Collected: data.totals.collected },
      ]
    )
  }

  if (error) return <ErrorCard message={(error as Error).message} />

  const loading = isLoading || !data
  const chartData = (data?.series ?? []).map((s) => ({ ...s, label: monthLabel(s.month) }))

  return (
    <div className="print-area space-y-4">
      <PrintHeading title="Sales report" subtitle={periodLabel(data?.window)} />
      <ReportToolbar onExport={handleExport} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <StatSkeletons count={3} />
        ) : (
          <>
            <StatCard
              title="Revenue"
              value={data.totals.revenue}
              isMoney
              hint="Invoiced in period (drafts & cancelled excluded)"
              icon={TrendingUp}
            />
            <StatCard
              title="Collected"
              value={data.totals.collected}
              isMoney
              hint="Customer payments received in period"
              icon={HandCoins}
              tone="success"
            />
            <StatCard
              title="Outstanding"
              value={data.totals.outstanding}
              isMoney
              hint="Still due on open invoices of the period"
              icon={Receipt}
              tone={data.totals.outstanding > 0 ? 'warning' : 'default'}
            />
          </>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Revenue vs collected, by month</CardTitle>
        </CardHeader>
        <CardContent className="h-[280px]">
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  width={56}
                  tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                />
                <ReTooltip formatter={(value) => formatMoney(Number(value))} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Bar dataKey="revenue" name="Revenue" fill="#16a34a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="collected" name="Collected" fill="#ea580c" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Invoices by status</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <RowSkeletons rows={3} cols={3} />
                ) : data.statusBreakdown.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No invoices in this period
                    </TableCell>
                  </TableRow>
                ) : (
                  data.statusBreakdown.map((s) => (
                    <TableRow key={s.status}>
                      <TableCell>
                        <DocStatusBadge status={s.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.count}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(s.total)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Receivables / Payables (shared aging view)
// ---------------------------------------------------------------------------
function AgingTab({ kind }: { kind: 'receivables' | 'payables' }) {
  const isAr = kind === 'receivables'
  const { data, isLoading, error } = useQuery<AgingData>({
    queryKey: [`reports-${kind}`],
    queryFn: () => get<AgingData>(`/api/reports/${kind}`),
    staleTime: STALE_TIME,
  })

  const handleExport = () => {
    if (!data) return
    const partyHeader = isAr ? 'Customer' : 'Supplier'
    exportXlsx(
      kind,
      [
        'Ref', partyHeader, 'Code', 'Invoice date', 'Due date', 'Status',
        'Total', 'Paid', 'Due', 'Days overdue', 'Bucket',
      ],
      data.rows.map((r) => ({
        Ref: r.ref,
        [partyHeader]: (isAr ? r.customer?.name : r.supplier?.name) ?? '',
        Code: (isAr ? r.customer?.code : r.supplier?.code) ?? '',
        'Invoice date': r.date.slice(0, 10),
        'Due date': r.dueDate ? r.dueDate.slice(0, 10) : '',
        Status: r.status,
        Total: r.total,
        Paid: r.paidAmount,
        Due: r.dueAmount,
        'Days overdue': r.daysOverdue,
        Bucket: r.bucket,
      }))
    )
  }

  if (error) return <ErrorCard message={(error as Error).message} />

  const loading = isLoading || !data
  const sumTotal = data?.rows.reduce((s, r) => s + r.total, 0) ?? 0
  const sumPaid = data?.rows.reduce((s, r) => s + r.paidAmount, 0) ?? 0

  return (
    <div className="print-area space-y-4">
      <PrintHeading
        title={isAr ? 'Receivables — open customer invoices' : 'Payables — open supplier invoices'}
        subtitle={data ? `As of ${formatDate(data.asOf)}` : undefined}
      />
      <ReportToolbar onExport={handleExport} />

      {/* Aging buckets */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-xl" />
            ))
          : data.summary.map((b) => (
              <Card key={b.bucket} className="gap-0 py-0">
                <CardContent className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {BUCKET_LABEL[b.bucket] ?? b.bucket}
                  </p>
                  <p className="mt-1 text-base font-bold tabular-nums sm:text-lg">
                    {formatMoney(b.amount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {b.count} invoice{b.count === 1 ? '' : 's'}
                  </p>
                </CardContent>
              </Card>
            ))}
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">
            {isAr ? 'Open customer invoices' : 'Open supplier invoices'}
          </CardTitle>
          {!loading && data.rows.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Total due{' '}
              <span className="font-semibold text-foreground">
                {formatMoney(data.totals.totalDue)}
              </span>{' '}
              · Overdue{' '}
              <span
                className={
                  data.totals.overdueAmount > 0
                    ? 'font-semibold text-rose-600'
                    : 'font-semibold text-foreground'
                }
              >
                {formatMoney(data.totals.overdueAmount)}
              </span>
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-auto print:max-h-none print:overflow-visible">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>{isAr ? 'Customer' : 'Supplier'}</TableHead>
                  <TableHead>Invoice date</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <RowSkeletons rows={4} cols={9} />
                ) : data.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10">
                      <EmptyState
                        icon={CircleCheck}
                        title={isAr ? 'No open receivables' : 'No open payables'}
                        description={
                          isAr
                            ? 'Every customer invoice has been settled.'
                            : 'Every supplier invoice has been settled.'
                        }
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  data.rows.map((r) => {
                    const party = isAr ? r.customer : r.supplier
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.ref}</TableCell>
                        <TableCell className="min-w-36">
                          <p className="truncate font-medium">{party?.name ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">{party?.code}</p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(r.date)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(r.dueDate)}
                        </TableCell>
                        <TableCell>
                          <DocStatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(r.total)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatMoney(r.paidAmount)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatMoney(r.dueAmount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.daysOverdue > 0 ? (
                            <span className="font-semibold text-rose-600">{r.daysOverdue} d</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
              {!loading && data.rows.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={5} className="font-semibold">
                      Totals
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(sumTotal)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(sumPaid)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(data.totals.totalDue)}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      overdue {formatMoney(data.totals.overdueAmount)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top lists (customers / products)
// ---------------------------------------------------------------------------
function TopTab({ from, to }: { from: string; to: string }) {
  const [mode, setMode] = useState<'customers' | 'products'>('customers')
  const params = new URLSearchParams({ type: mode })
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const search = params.toString()

  const { data, isLoading, error } = useQuery<TopData>({
    queryKey: ['reports-top', mode, from, to],
    queryFn: () => get<TopData>(`/api/reports/top?${search}`),
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
  })

  const handleExport = () => {
    if (!data) return
    if (data.type === 'customers') {
      exportXlsx(
        'top-customers',
        ['Rank', 'Customer', 'Code', 'Invoices', 'Revenue', 'Paid', 'Share %'],
        (data.rows as TopCustomerRow[]).map((r, i) => ({
          Rank: i + 1,
          Customer: r.name,
          Code: r.code,
          Invoices: r.invoiceCount,
          Revenue: r.revenue,
          Paid: r.paid,
          'Share %': sharePct(r.revenue, data.total),
        }))
      )
    } else {
      exportXlsx(
        'top-products',
        ['Rank', 'Product', 'Ref', 'Qty', 'Amount', 'Share %'],
        (data.rows as TopProductRow[]).map((r, i) => ({
          Rank: i + 1,
          Product: r.label,
          Ref: r.ref,
          Qty: r.qty,
          Amount: r.amount,
          'Share %': sharePct(r.amount, data.total),
        }))
      )
    }
  }

  if (error) return <ErrorCard message={(error as Error).message} />

  const loading = isLoading || !data
  // During toggles keepPreviousData may briefly hold the previous list —
  // always render what `data.type` actually contains.
  const activeType = data?.type ?? mode
  const customerRows = activeType === 'customers' ? ((data?.rows ?? []) as TopCustomerRow[]) : []
  const productRows = activeType === 'products' ? ((data?.rows ?? []) as TopProductRow[]) : []
  const total = data?.total ?? 0

  return (
    <div className="print-area space-y-4">
      <PrintHeading
        title={activeType === 'customers' ? 'Top customers by revenue' : 'Top products by amount sold'}
        subtitle={periodLabel(data?.window)}
      />
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="Top list type">
          <Button
            size="sm"
            variant={mode === 'customers' ? 'default' : 'outline'}
            onClick={() => setMode('customers')}
          >
            <Users className="h-4 w-4" aria-hidden="true" /> Customers
          </Button>
          <Button
            size="sm"
            variant={mode === 'products' ? 'default' : 'outline'}
            onClick={() => setMode('products')}
          >
            <Package className="h-4 w-4" aria-hidden="true" /> Products
          </Button>
        </div>
        <ReportToolbar onExport={handleExport} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {activeType === 'customers' ? 'Top customers by revenue' : 'Top products by amount sold'}
          </CardTitle>
          {!loading && (customerRows.length > 0 || productRows.length > 0) && (
            <p className="text-xs text-muted-foreground">
              Window total: <span className="font-semibold text-foreground">{formatMoney(total)}</span>
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-auto print:max-h-none print:overflow-visible">
            <Table>
              <TableHeader>
                {activeType === 'customers' ? (
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                ) : (
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty sold</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                )}
              </TableHeader>
              <TableBody>
                {loading ? (
                  <RowSkeletons rows={5} cols={6} />
                ) : activeType === 'customers' ? (
                  customerRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10">
                        <EmptyState
                          icon={Users}
                          title="No customer invoices in this period"
                          description="Draft and cancelled invoices are excluded."
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    customerRows.map((r, i) => (
                      <TableRow key={r.id}>
                        <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          <p className="truncate font-medium">{r.name}</p>
                          <p className="text-xs text-muted-foreground">{r.code}</p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.invoiceCount}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatMoney(r.revenue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatMoney(r.paid)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {sharePct(r.revenue, total) || '—'}%
                        </TableCell>
                      </TableRow>
                    ))
                  )
                ) : productRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10">
                      <EmptyState
                        icon={Package}
                        title="No product sales in this period"
                        description="Only invoice lines linked to a catalog product are counted."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  productRows.map((r, i) => (
                    <TableRow key={r.id}>
                      <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>
                        <p className="truncate font-medium">{r.label}</p>
                        <p className="text-xs text-muted-foreground">{r.ref}</p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.qty}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatMoney(r.amount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {sharePct(r.amount, total) || '—'}%
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tax (VAT) summary
// ---------------------------------------------------------------------------
function TaxTab({ from, to }: { from: string; to: string }) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const search = params.toString()

  const { data, isLoading, error } = useQuery<TaxData>({
    queryKey: ['reports-tax', from, to],
    queryFn: () => get<TaxData>(`/api/reports/tax${search ? `?${search}` : ''}`),
    staleTime: STALE_TIME,
  })

  const handleExport = () => {
    if (!data) return
    exportXlsx(
      'tax',
      ['Rate %', 'Net', 'VAT'],
      [
        ...data.rows.map((r) => ({ 'Rate %': r.rate, Net: r.net, VAT: r.vat })),
        { 'Rate %': 'TOTAL', Net: data.totals.net, VAT: data.totals.vat },
      ]
    )
  }

  if (error) return <ErrorCard message={(error as Error).message} />

  const loading = isLoading || !data

  return (
    <div className="print-area space-y-4">
      <PrintHeading title="Tax (VAT) summary" subtitle={periodLabel(data?.window)} />
      <ReportToolbar onExport={handleExport} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">VAT by rate</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rate</TableHead>
                  <TableHead className="text-right">Net (ex-VAT)</TableHead>
                  <TableHead className="text-right">VAT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <RowSkeletons rows={3} cols={3} />
                ) : data.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-10">
                      <EmptyState
                        icon={Receipt}
                        title="No taxable activity in this period"
                        description="Invoice lines from drafts and cancelled invoices are excluded."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  data.rows.map((r) => (
                    <TableRow key={r.rate}>
                      <TableCell className="font-medium tabular-nums">{r.rate}%</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(r.net)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatMoney(r.vat)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {!loading && data.rows.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">Totals</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(data.totals.net)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(data.totals.vat)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Computed from invoice lines of non-draft, non-cancelled invoices
        {data?.window ? ` dated ${periodLabel(data.window)}` : ''}.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inventory valuation
// ---------------------------------------------------------------------------
function InventoryTab() {
  const { data, isLoading, error } = useQuery<InventoryData>({
    queryKey: ['reports-inventory'],
    queryFn: () => get<InventoryData>('/api/reports/inventory'),
    staleTime: STALE_TIME,
  })

  const handleExport = () => {
    if (!data) return
    exportXlsx(
      'inventory',
      ['Ref', 'Product', 'Stock', 'Min stock', 'Unit cost', 'Stock value', 'Low'],
      data.rows.map((r) => ({
        Ref: r.ref,
        Product: r.label,
        Stock: r.stockQty,
        'Min stock': r.minStock,
        'Unit cost': r.costPrice,
        'Stock value': r.stockValue,
        Low: r.low ? 'yes' : 'no',
      }))
    )
  }

  if (error) return <ErrorCard message={(error as Error).message} />

  const loading = isLoading || !data

  return (
    <div className="print-area space-y-4">
      <PrintHeading
        title="Inventory valuation"
        subtitle={data ? `As of ${formatDate(data.asOf)}` : undefined}
      />
      <ReportToolbar onExport={handleExport} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <StatSkeletons count={3} />
        ) : (
          <>
            <StatCard
              title="Total stock value"
              value={data.totals.totalValue}
              isMoney
              hint={`${data.totals.productCount} products valued at cost price`}
              icon={Boxes}
            />
            <StatCard
              title="Low stock items"
              value={data.totals.lowCount}
              hint="At or below minimum level"
              icon={TriangleAlert}
              tone={data.totals.lowCount > 0 ? 'warning' : 'default'}
            />
            <StatCard
              title="Products"
              value={data.totals.productCount}
              hint="Type PRODUCT (services excluded)"
              icon={Package}
            />
          </>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Stock by value</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-auto print:max-h-none print:overflow-visible">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="text-right">Stock value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <RowSkeletons rows={5} cols={7} />
                ) : data.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10">
                      <EmptyState
                        icon={Package}
                        title="No products in the catalog"
                        description="Add products to see a stock valuation."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  data.rows.map((r) => (
                    <TableRow
                      key={r.id}
                      className={r.low ? 'bg-amber-50/60 hover:bg-amber-50/80' : undefined}
                    >
                      <TableCell className="font-medium">{r.ref}</TableCell>
                      <TableCell>
                        <p className="truncate font-medium">{r.label}</p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          {r.low && (
                            <TriangleAlert
                              className="h-3.5 w-3.5 text-amber-600"
                              aria-hidden="true"
                            />
                          )}
                          {r.stockQty}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.minStock}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatMoney(r.costPrice)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatMoney(r.stockValue)}
                      </TableCell>
                      <TableCell>
                        {r.low ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                            <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" /> Low
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">OK</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function Reports() {
  const [tab, setTab] = useState('sales')
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`)
  const [to, setTo] = useState(toDateInput(new Date()))
  const showRange = RANGE_TABS.has(tab)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        description="Business insight — sales, receivables, payables, top lists, VAT and stock."
        icon={ChartColumn}
      />

      {showRange && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-end sm:gap-4">
          <div className="space-y-1">
            <Label htmlFor="report-from" className="text-xs text-muted-foreground">
              From
            </Label>
            <Input
              id="report-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full sm:w-40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="report-to" className="text-xs text-muted-foreground">
              To
            </Label>
            <Input
              id="report-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="w-full sm:w-40"
            />
          </div>
          <p className="text-xs text-muted-foreground sm:ml-auto sm:pb-2">
            Applies to the Sales, Top lists and Tax summary tabs
          </p>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="receivables">Receivables</TabsTrigger>
          <TabsTrigger value="payables">Payables</TabsTrigger>
          <TabsTrigger value="top">Top lists</TabsTrigger>
          <TabsTrigger value="tax">Tax summary</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-0">
          <SalesTab from={from} to={to} />
        </TabsContent>
        <TabsContent value="receivables" className="mt-0">
          <AgingTab kind="receivables" />
        </TabsContent>
        <TabsContent value="payables" className="mt-0">
          <AgingTab kind="payables" />
        </TabsContent>
        <TabsContent value="top" className="mt-0">
          <TopTab from={from} to={to} />
        </TabsContent>
        <TabsContent value="tax" className="mt-0">
          <TaxTab from={from} to={to} />
        </TabsContent>
        <TabsContent value="inventory" className="mt-0">
          <InventoryTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

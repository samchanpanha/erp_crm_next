'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRightLeft,
  Ban,
  CheckCircle2,
  Copy,
  CreditCard,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Receipt,
  Sigma,
  TriangleAlert,
  Trash2,
} from 'lucide-react'

import { del, get, post, put } from '../lib/api'
import { EmptyState, PageHeader } from '../shared/page-header'
import { DocStatusBadge } from '../shared/status-badge'
import { StatCard } from '../shared/stat-card'
import { formatMoney, formatDate, toDateInput } from '../shared/format'
import { LineEditor, type EditorLine, type ProductOption } from '../shared/line-editor'
import { DocumentPrintDialog, type InvoicePrintData } from '../shared/print-document'
import { RecordPaymentDialog, type PaymentRow, type PaymentTarget } from './payments'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ThirdPartyRef {
  id: string
  name: string
  code: string
  // Enriched fields returned by the detail API for the print engine (optional)
  address?: string | null
  zip?: string | null
  city?: string | null
  country?: string | null
  email?: string | null
  phone?: string | null
  vatNumber?: string | null
}

interface DocLine {
  id: string
  productId: string | null
  label: string
  description?: string | null
  qty: number
  unitPrice: number
  discountPct: number
  vatRate: number
  sort: number
}

interface InvoiceListItem {
  id: string
  ref: string
  status: string
  date: string
  dueDate: string | null
  subtotal: number
  discountTotal: number
  vatTotal: number
  total: number
  paidAmount: number
  notes: string | null
  thirdParty: ThirdPartyRef
  _count: { lines: number; payments: number }
}

interface InvoiceDetail extends Omit<InvoiceListItem, '_count'> {
  lines: DocLine[]
  payments: PaymentRow[]
  saleOrder?: { id: string; ref: string; status: string } | null
}

interface DocForm {
  thirdPartyId: string
  date: string
  dueDate: string
  notes: string
  lines: EditorLine[]
}

const STATUSES = ['DRAFT', 'UNPAID', 'PARTIAL', 'PAID', 'CANCELLED'] as const

const round2 = (n: number) => Math.round(n * 100) / 100

function qs(params: Record<string, string>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v && v !== 'ALL') sp.set(k, v)
  const s = sp.toString()
  return s ? `?${s}` : ''
}

function normalizeList<T>(raw: unknown, keys: string[]): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    for (const k of keys) if (Array.isArray(obj[k])) return obj[k] as T[]
  }
  return []
}

const emptyForm = (): DocForm => ({
  thirdPartyId: '',
  date: toDateInput(new Date()),
  dueDate: '',
  notes: '',
  lines: [{ label: '', qty: 1, unitPrice: 0, discountPct: 0, vatRate: 20 }],
})

const toEditorLines = (lines: DocLine[] | undefined): EditorLine[] =>
  (lines ?? []).map((l) => ({
    productId: l.productId ?? undefined,
    label: l.label,
    qty: l.qty,
    unitPrice: l.unitPrice,
    discountPct: l.discountPct,
    vatRate: l.vatRate,
  }))

const remainingOf = (i: { total: number; paidAmount: number }) => round2(i.total - i.paidAmount)

/** Map a loaded InvoiceDetail onto the printable-document shape. */
function buildPrintData(d: InvoiceDetail): InvoicePrintData {
  return {
    ref: d.ref,
    date: d.date,
    dueDate: d.dueDate,
    status: d.status,
    subtotal: d.subtotal,
    discountTotal: d.discountTotal,
    vatTotal: d.vatTotal,
    total: d.total,
    paidAmount: d.paidAmount,
    notes: d.notes,
    thirdParty: {
      name: d.thirdParty.name,
      code: d.thirdParty.code,
      address: d.thirdParty.address ?? null,
      zip: d.thirdParty.zip ?? null,
      city: d.thirdParty.city ?? null,
      country: d.thirdParty.country ?? null,
      email: d.thirdParty.email ?? null,
      phone: d.thirdParty.phone ?? null,
      taxId: d.thirdParty.vatNumber ?? null,
    },
    lines: d.lines.map((l) => ({
      label: l.label,
      description: l.description ?? null,
      qty: l.qty,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      vatRate: l.vatRate,
    })),
    linkedRef: d.saleOrder?.ref,
  }
}

/** True when an unpaid invoice is past its due date */
function isOverdue(i: { status: string; dueDate: string | null }): boolean {
  if (!i.dueDate || !['UNPAID', 'PARTIAL'].includes(i.status)) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(i.dueDate) < today
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function InvoicesModule() {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [q, setQ] = useState('')
  const [status, setStatus] = useState('ALL')
  const [tpFilter, setTpFilter] = useState('ALL')
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<InvoiceDetail | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [form, setForm] = useState<DocForm>(emptyForm)
  const [payTarget, setPayTarget] = useState<PaymentTarget | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [printData, setPrintData] = useState<InvoicePrintData | null>(null)

  const listQ = useQuery({
    queryKey: ['invoices', q, status, tpFilter],
    queryFn: () => get<InvoiceListItem[]>(`/api/invoices${qs({ q, status, thirdPartyId: tpFilter })}`),
  })

  const thirdPartiesQ = useQuery({
    queryKey: ['third-parties', 'for-docs'],
    queryFn: async () => {
      try {
        const rows = normalizeList<ThirdPartyRef & { type?: string }>(
          await get<unknown>('/api/third-parties'),
          ['thirdParties', 'items', 'data']
        )
        return rows.filter((t) => t.type !== 'SUPPLIER')
      } catch {
        return [] as ThirdPartyRef[]
      }
    },
  })

  const productsQ = useQuery({
    queryKey: ['products', 'active-for-docs'],
    queryFn: async () => {
      try {
        return normalizeList<ProductOption>(await get<unknown>('/api/products?status=ACTIVE'), ['products', 'items', 'data'])
      } catch {
        return [] as ProductOption[]
      }
    },
  })

  const detailQ = useQuery({
    queryKey: ['invoice', detailId],
    enabled: !!detailId,
    queryFn: () => get<InvoiceDetail>(`/api/invoices/${detailId}`),
  })

  const list = listQ.data ?? []
  const thirdParties = thirdPartiesQ.data ?? []
  const products = productsQ.data ?? []
  const detail = detailId ? detailQ.data : undefined

  // ----- Stats -----
  const stats = useMemo(() => {
    const all = listQ.data ?? []
    const outstanding = all
      .filter((i) => i.status === 'UNPAID' || i.status === 'PARTIAL')
      .reduce((s, i) => s + remainingOf(i), 0)
    const overdue = all.filter(isOverdue).length
    const collected = all.reduce((s, i) => s + i.paidAmount, 0)
    return { outstanding, overdue, collected }
  }, [listQ.data])

  // ----- Mutations -----
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['invoices'] })
    qc.invalidateQueries({ queryKey: ['invoice'] })
    qc.invalidateQueries({ queryKey: ['payments'] })
    qc.invalidateQueries({ queryKey: ['sale-orders', 'lite'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const saveMut = useMutation({
    mutationFn: async (payload: DocForm) => {
      const body = {
        thirdPartyId: payload.thirdPartyId,
        date: payload.date || undefined,
        dueDate: payload.dueDate || undefined,
        notes: payload.notes || undefined,
        lines: payload.lines
          .filter((l) => l.label.trim().length > 0)
          .map((l) => ({
            productId: l.productId || undefined,
            label: l.label.trim(),
            qty: l.qty,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            vatRate: l.vatRate,
          })),
      }
      if (editing) return put<InvoiceDetail>(`/api/invoices/${editing.id}`, body)
      return post<InvoiceDetail>('/api/invoices', body)
    },
    onSuccess: (data) => {
      invalidateAll()
      setCreateOpen(false)
      setEditing(null)
      toast({ title: editing ? 'Invoice updated' : 'Invoice created', description: `${data.ref} · ${formatMoney(data.total)}` })
    },
    onError: (e: Error) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  })

  const actionMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      put<InvoiceDetail>(`/api/invoices/${id}`, { action }),
    onSuccess: (_data, vars) => {
      invalidateAll()
      toast({ title: vars.action === 'validate' ? 'Invoice validated' : 'Invoice cancelled' })
    },
    onError: (e: Error) => toast({ title: 'Action failed', description: e.message, variant: 'destructive' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => del(`/api/invoices/${id}`),
    onSuccess: () => {
      invalidateAll()
      setDetailId(null)
      toast({ title: 'Draft invoice deleted' })
    },
    onError: (e: Error) => toast({ title: 'Delete failed', description: e.message, variant: 'destructive' }),
  })

  /** Duplicate-as-draft: same create payload the form sends, date = today. */
  const duplicateMut = useMutation({
    mutationFn: async (id: string) => {
      const d = await qc.fetchQuery({
        queryKey: ['invoice', id],
        queryFn: () => get<InvoiceDetail>(`/api/invoices/${id}`),
      })
      return post<InvoiceDetail>('/api/invoices', {
        thirdPartyId: d.thirdParty.id,
        date: toDateInput(new Date()),
        notes: d.notes || undefined,
        lines: d.lines.map((l) => ({
          productId: l.productId || undefined,
          label: l.label,
          description: l.description || undefined,
          qty: l.qty,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          vatRate: l.vatRate,
          sort: l.sort,
        })),
      })
    },
    onSuccess: (data) => {
      invalidateAll()
      setDetailId(null)
      toast({ title: `Duplicated as ${data.ref}`, description: 'A new draft invoice was created from this one.' })
    },
    onError: (e: Error) => toast({ title: 'Duplicate failed', description: e.message, variant: 'destructive' }),
  })

  const busy =
    saveMut.isPending || actionMut.isPending || deleteMut.isPending || duplicateMut.isPending

  // ----- Handlers -----
  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm())
    setCreateOpen(true)
  }

  const openEdit = (i: Omit<InvoiceListItem, '_count'>) => {
    setEditing(null)
    setDetailId(null)
    qc.fetchQuery({
      queryKey: ['invoice', i.id],
      queryFn: () => get<InvoiceDetail>(`/api/invoices/${i.id}`),
    }).then((d) => {
      setForm({
        thirdPartyId: d.thirdParty.id,
        date: toDateInput(d.date),
        dueDate: toDateInput(d.dueDate),
        notes: d.notes ?? '',
        lines: toEditorLines(d.lines),
      })
      setEditing(d)
      setCreateOpen(true)
    })
  }

  const openPayment = (i: { id: string; ref: string; total: number; paidAmount: number; thirdParty: ThirdPartyRef }) => {
    setPayTarget({
      id: i.id,
      ref: i.ref,
      thirdPartyName: i.thirdParty.name,
      remaining: remainingOf(i),
    })
    setPayOpen(true)
  }

  /** Open the print dialog for an invoice (reuses the detail query cache). */
  const openPrint = (i: Pick<InvoiceListItem, 'id'>) => {
    qc.fetchQuery({
      queryKey: ['invoice', i.id],
      queryFn: () => get<InvoiceDetail>(`/api/invoices/${i.id}`),
    }).then((d) => {
      setPrintData(buildPrintData(d))
      setPrintOpen(true)
    })
  }

  const submitForm = () => {
    if (!form.thirdPartyId) {
      toast({ title: 'Third party required', variant: 'destructive' })
      return
    }
    const usable = form.lines.filter((l) => l.label.trim().length > 0)
    if (usable.length === 0) {
      toast({ title: 'At least one line required', variant: 'destructive' })
      return
    }
    if (usable.some((l) => !(l.qty > 0))) {
      toast({ title: 'Invalid quantity', description: 'Quantities must be greater than 0.', variant: 'destructive' })
      return
    }
    saveMut.mutate(form)
  }

  const availableActions = (i: InvoiceListItem) => {
    const act = (action: string, label: string, icon: React.ReactNode, destructive = false) => (
      <DropdownMenuItem
        key={action}
        disabled={busy}
        className={destructive ? 'text-destructive focus:text-destructive' : undefined}
        onSelect={() => actionMut.mutate({ id: i.id, action })}
      >
        {icon}
        {label}
      </DropdownMenuItem>
    )
    const items: React.ReactNode[] = []
    items.push(
      <DropdownMenuItem key="print" onSelect={() => openPrint(i)}>
        <Printer className="h-4 w-4" />
        Print / PDF
      </DropdownMenuItem>
    )
    if (i.status === 'DRAFT') items.push(act('validate', 'Validate (send)', <CheckCircle2 className="h-4 w-4" />))
    if (['UNPAID', 'PARTIAL'].includes(i.status)) {
      items.push(
        <DropdownMenuItem key="pay" onSelect={() => openPayment(i)}>
          <CreditCard className="h-4 w-4" />
          Record payment
        </DropdownMenuItem>
      )
    }
    if (['DRAFT', 'UNPAID', 'PARTIAL'].includes(i.status)) {
      items.push(act('cancel', 'Cancel invoice', <Ban className="h-4 w-4" />, true))
    }
    items.push(
      <DropdownMenuItem key="duplicate" disabled={busy} onSelect={() => duplicateMut.mutate(i.id)}>
        <Copy className="h-4 w-4" />
        Duplicate
      </DropdownMenuItem>
    )
    if (i.status === 'DRAFT') {
      items.push(
        <DropdownMenuSeparator key="sep-del" />,
        <DropdownMenuItem
          key="delete"
          disabled={busy}
          className="text-destructive focus:text-destructive"
          onSelect={() => deleteMut.mutate(i.id)}
        >
          <Trash2 className="h-4 w-4" />
          Delete draft
        </DropdownMenuItem>
      )
    }
    return items
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Receipt}
        title="Customer invoices"
        description="Bill your customers and keep an eye on what is outstanding or overdue."
        actions={
          <Button onClick={openCreate} className="h-10">
            <Plus className="h-4 w-4" /> New invoice
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="Outstanding"
          value={stats.outstanding}
          isMoney
          icon={Sigma}
          tone="warning"
          hint="Unpaid + partially paid balances"
        />
        <StatCard
          title="Overdue invoices"
          value={stats.overdue}
          icon={TriangleAlert}
          tone="danger"
          hint="Past due date and not fully paid"
        />
        <StatCard
          title="Collected"
          value={stats.collected}
          isMoney
          icon={CreditCard}
          tone="success"
          hint="Total payments received"
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search ref, client or notes…"
          className="sm:max-w-xs"
          aria-label="Search invoices"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replaceAll('_', ' ').charAt(0) + s.replaceAll('_', ' ').slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tpFilter} onValueChange={setTpFilter}>
          <SelectTrigger className="w-full sm:w-56" aria-label="Filter by third party">
            <SelectValue placeholder="Third party" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All third parties</SelectItem>
            {thirdParties.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {listQ.isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Receipt}
                title="No invoices found"
                description="Create an invoice directly or bill an order from the Sale Orders module."
                actionLabel="New invoice"
                onAction={openCreate}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead>Third party</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-32 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((i) => (
                    <TableRow key={i.id} className="cursor-pointer" onClick={() => setDetailId(i.id)}>
                      <TableCell className="font-medium tabular-nums">{i.ref}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(i.date)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          {formatDate(i.dueDate)}
                          {isOverdue(i) && (
                            <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                              Overdue
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-44 truncate">{i.thirdParty.name}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatMoney(i.total)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatMoney(i.paidAmount)}
                      </TableCell>
                      <TableCell>
                        <DocStatusBadge status={i.status} />
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="relative h-9 w-9 before:absolute before:-inset-1.5"
                            onClick={() => setDetailId(i.id)}
                            aria-label={`View ${i.ref}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {i.status === 'DRAFT' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="relative h-9 w-9 before:absolute before:-inset-1.5"
                              onClick={() => openEdit(i)}
                              aria-label={`Edit ${i.ref}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {['UNPAID', 'PARTIAL'].includes(i.status) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="relative h-9 w-9 before:absolute before:-inset-1.5 text-primary"
                              onClick={() => openPayment(i)}
                              aria-label={`Record payment for ${i.ref}`}
                            >
                              <CreditCard className="h-4 w-4" />
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="relative h-9 w-9 before:absolute before:-inset-1.5"
                                aria-label={`Actions for ${i.ref}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              {availableActions(i)}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setEditing(null) } }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit invoice ${editing.ref}` : 'New customer invoice'}</DialogTitle>
            <DialogDescription>
              Draft invoices stay editable — validate them to request payment.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="in-tp">Third party *</Label>
                <Select value={form.thirdPartyId} onValueChange={(v) => setForm((f) => ({ ...f, thirdPartyId: v }))}>
                  <SelectTrigger id="in-tp" className="w-full" aria-label="Third party">
                    <SelectValue placeholder={thirdParties.length ? 'Select…' : 'Loading…'} />
                  </SelectTrigger>
                  <SelectContent>
                    {thirdParties.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="in-date">Date</Label>
                <Input
                  id="in-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="in-due">Due date</Label>
                <Input
                  id="in-due"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
            </div>

            <LineEditor
              lines={form.lines}
              onChange={(lines) => setForm((f) => ({ ...f, lines }))}
              products={products}
            />

            <div className="space-y-1.5">
              <Label htmlFor="in-notes">Notes</Label>
              <Textarea
                id="in-notes"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Payment terms, bank details…"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCreateOpen(false); setEditing(null) }} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={busy}>
              {editing ? 'Save changes' : 'Create invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="sm:max-w-2xl">
          {detail ? (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="tabular-nums">{detail.ref}</DialogTitle>
                  <DocStatusBadge status={detail.status} />
                </div>
                <DialogDescription>
                  {detail.thirdParty.name} ({detail.thirdParty.code})
                  {detail.saleOrder ? ` · from order ${detail.saleOrder.ref}` : ''}
                </DialogDescription>
              </DialogHeader>

              <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">Date</dt>
                    <dd>{formatDate(detail.date)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Due date</dt>
                    <dd className={isOverdue(detail) ? 'font-medium text-rose-600' : undefined}>
                      {formatDate(detail.dueDate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Total</dt>
                    <dd className="font-semibold">{formatMoney(detail.total)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Remaining</dt>
                    <dd className="font-semibold text-primary">{formatMoney(remainingOf(detail))}</dd>
                  </div>
                </dl>

                {detail.notes && (
                  <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">{detail.notes}</p>
                )}

                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Label</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit price</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.lines.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell>{l.label}</TableCell>
                          <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(l.unitPrice)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatMoney(l.qty * l.unitPrice * (1 - l.discountPct / 100))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <dl className="ml-auto max-w-56 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="tabular-nums">{formatMoney(detail.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">VAT</dt>
                    <dd className="tabular-nums">{formatMoney(detail.vatTotal)}</dd>
                  </div>
                  <div className="flex justify-between border-t pt-1 font-semibold">
                    <dt>Total</dt>
                    <dd className="tabular-nums text-primary">{formatMoney(detail.total)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Paid</dt>
                    <dd className="tabular-nums text-emerald-600">{formatMoney(detail.paidAmount)}</dd>
                  </div>
                </dl>

                {detail.payments.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Payments
                    </p>
                    <ul className="divide-y rounded-lg border text-sm">
                      {detail.payments.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                          <span className="flex items-center gap-2 min-w-0">
                            <CreditCard className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">
                              {formatDate(p.date)} · {p.reference || p.method.replaceAll('_', ' ').toLowerCase()}
                            </span>
                          </span>
                          <span className="font-medium tabular-nums text-emerald-600">
                            +{formatMoney(p.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
                <div>
                  {detail.saleOrder && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => { setDetailId(null); window.location.hash = '#/sale-orders' }}
                    >
                      <ArrowRightLeft className="h-4 w-4" /> View order {detail.saleOrder.ref}
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => openPrint(detail)}>
                    <Printer className="h-4 w-4" /> Print / PDF
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => duplicateMut.mutate(detail.id)}
                  >
                    <Copy className="h-4 w-4" /> Duplicate
                  </Button>
                  {detail.status === 'DRAFT' && (
                    <Button size="sm" disabled={busy} onClick={() => actionMut.mutate({ id: detail.id, action: 'validate' })}>
                      <CheckCircle2 className="h-4 w-4" /> Validate
                    </Button>
                  )}
                  {detail.status === 'DRAFT' && (
                    <Button size="sm" variant="outline" onClick={() => openEdit(detail)} disabled={busy}>
                      <Pencil className="h-4 w-4" /> Edit
                    </Button>
                  )}
                  {['UNPAID', 'PARTIAL'].includes(detail.status) && (
                    <Button size="sm" onClick={() => openPayment(detail)} disabled={remainingOf(detail) <= 0}>
                      <CreditCard className="h-4 w-4" /> Record payment
                    </Button>
                  )}
                  {['DRAFT', 'UNPAID', 'PARTIAL'].includes(detail.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      disabled={busy}
                      onClick={() => actionMut.mutate({ id: detail.id, action: 'cancel' })}
                    >
                      <Ban className="h-4 w-4" /> Cancel
                    </Button>
                  )}
                  {detail.status === 'DRAFT' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      disabled={busy}
                      onClick={() => deleteMut.mutate(detail.id)}
                    >
                      <Trash2 className="h-4 w-4" /> Delete
                    </Button>
                  )}
                  {['PAID', 'CANCELLED'].includes(detail.status) && (
                    <p className="mr-1 text-xs text-muted-foreground">
                      {detail.status === 'PAID' ? 'This invoice is fully settled.' : 'This invoice was cancelled.'}
                    </p>
                  )}
                </div>
              </DialogFooter>
            </>
          ) : (
            <div className="space-y-3 py-4" aria-busy="true">
              <DialogTitle className="sr-only">Loading invoice…</DialogTitle>
              <DialogDescription className="sr-only">Fetching invoice details.</DialogDescription>
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        mode="fixed"
        target={payTarget}
      />

      {printData && (
        <DocumentPrintDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          kind="INVOICE"
          data={printData}
        />
      )}
    </div>
  )
}

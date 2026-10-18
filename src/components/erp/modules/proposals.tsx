'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  Copy,
  Eye,
  FileText,
  Handshake,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Trash2,
  TrendingUp,
  XCircle,
} from 'lucide-react'

import { del, get, post, put } from '../lib/api'
import { navigate } from '../lib/nav'
import { EmptyState, PageHeader } from '../shared/page-header'
import { DocStatusBadge } from '../shared/status-badge'
import { StatCard } from '../shared/stat-card'
import { formatMoney, formatDate, relativeDays, toDateInput } from '../shared/format'
import { LineEditor, type EditorLine, type ProductOption } from '../shared/line-editor'
import { DocumentPrintDialog, type InvoicePrintData } from '../shared/print-document'
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

interface ProposalListItem {
  id: string
  ref: string
  status: string
  date: string
  validUntil: string | null
  subtotal: number
  discountTotal: number
  vatTotal: number
  total: number
  notes: string | null
  thirdParty: ThirdPartyRef
  _count: { lines: number }
}

interface ProposalDetail extends Omit<ProposalListItem, '_count'> {
  lines: DocLine[]
}

interface SaleOrderLite {
  id: string
  ref: string
  status: string
  proposalId: string | null
  total: number
}

interface DocForm {
  thirdPartyId: string
  date: string
  validUntil: string
  notes: string
  lines: EditorLine[]
}

const STATUSES = ['DRAFT', 'VALIDATED', 'ACCEPTED', 'REFUSED', 'CLOSED'] as const

function qs(params: Record<string, string>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v && v !== 'ALL') sp.set(k, v)
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** Defensive normalization — other agents may ship slightly different list shapes. */
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
  validUntil: '',
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

/** Map a loaded ProposalDetail onto the printable-document shape (dueDate ← validUntil). */
function buildPrintData(d: ProposalDetail, linkedRef?: string): InvoicePrintData {
  return {
    ref: d.ref,
    date: d.date,
    dueDate: d.validUntil,
    status: d.status,
    subtotal: d.subtotal,
    discountTotal: d.discountTotal,
    vatTotal: d.vatTotal,
    total: d.total,
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
    linkedRef,
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ProposalsModule() {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [q, setQ] = useState('')
  const [status, setStatus] = useState('ALL')
  const [tpFilter, setTpFilter] = useState('ALL')
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ProposalDetail | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [form, setForm] = useState<DocForm>(emptyForm)
  const [printOpen, setPrintOpen] = useState(false)
  const [printData, setPrintData] = useState<InvoicePrintData | null>(null)

  // ----- Data -----
  const listQ = useQuery({
    queryKey: ['proposals', q, status, tpFilter],
    queryFn: () => get<ProposalListItem[]>(`/api/proposals${qs({ q, status, thirdPartyId: tpFilter })}`),
  })

  const thirdPartiesQ = useQuery({
    queryKey: ['third-parties', 'for-docs'],
    queryFn: async () => {
      try {
        const rows = normalizeList<ThirdPartyRef & { type?: string }>(
          await get<unknown>('/api/third-parties'),
          ['thirdParties', 'items', 'data']
        )
        // sales documents target customers/prospects — hide pure suppliers
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

  const saleOrdersLiteQ = useQuery({
    queryKey: ['sale-orders', 'lite'],
    queryFn: async () => {
      try {
        return await get<SaleOrderLite[]>('/api/sale-orders')
      } catch {
        return [] as SaleOrderLite[]
      }
    },
  })

  const detailQ = useQuery({
    queryKey: ['proposal', detailId],
    enabled: !!detailId,
    queryFn: () => get<ProposalDetail>(`/api/proposals/${detailId}`),
  })

  const list = listQ.data ?? []
  const thirdParties = thirdPartiesQ.data ?? []
  const products = productsQ.data ?? []
  const saleOrdersLite = saleOrdersLiteQ.data ?? []
  const detail = detailId ? detailQ.data : undefined

  // ----- Stats -----
  const stats = useMemo(() => {
    const all = listQ.data ?? []
    const validatedValue = all
      .filter((p) => p.status === 'VALIDATED')
      .reduce((s, p) => s + p.total, 0)
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const acceptedThisMonth = all.filter((p) => {
      if (p.status !== 'ACCEPTED') return false
      return new Date(p.date) >= monthStart
    }).length
    const conversions = saleOrdersLite.filter((o) => o.proposalId).length
    return { validatedValue, acceptedThisMonth, conversions }
  }, [listQ.data, saleOrdersLite])

  // ----- Mutations -----
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['proposals'] })
    qc.invalidateQueries({ queryKey: ['proposal'] })
    qc.invalidateQueries({ queryKey: ['sale-orders', 'lite'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const saveMut = useMutation({
    mutationFn: async (payload: DocForm) => {
      const body = {
        thirdPartyId: payload.thirdPartyId,
        date: payload.date || undefined,
        validUntil: payload.validUntil || undefined,
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
      if (editing) return put<ProposalDetail>(`/api/proposals/${editing.id}`, body)
      return post<ProposalDetail>('/api/proposals', body)
    },
    onSuccess: (data) => {
      invalidateAll()
      setCreateOpen(false)
      setEditing(null)
      toast({ title: editing ? 'Proposal updated' : 'Proposal created', description: `${data.ref} · ${formatMoney(data.total)}` })
    },
    onError: (e: Error) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  })

  const actionMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      put<unknown>(`/api/proposals/${id}`, { action }),
    onSuccess: (_data, vars) => {
      invalidateAll()
      if (vars.action === 'convert_to_order') {
        setDetailId(null)
        toast({ title: 'Converted to sale order', description: 'Opening Sale Orders…' })
        navigate('sale-orders')
      } else {
        toast({ title: 'Proposal updated', description: `Action: ${vars.action.replaceAll('_', ' ')}` })
      }
    },
    onError: (e: Error) => toast({ title: 'Action failed', description: e.message, variant: 'destructive' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => del(`/api/proposals/${id}`),
    onSuccess: () => {
      invalidateAll()
      setDetailId(null)
      toast({ title: 'Draft proposal deleted' })
    },
    onError: (e: Error) => toast({ title: 'Delete failed', description: e.message, variant: 'destructive' }),
  })

  /** Duplicate-as-draft: same create payload the form sends, date = today. */
  const duplicateMut = useMutation({
    mutationFn: async (id: string) => {
      const d = await qc.fetchQuery({
        queryKey: ['proposal', id],
        queryFn: () => get<ProposalDetail>(`/api/proposals/${id}`),
      })
      return post<ProposalDetail>('/api/proposals', {
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
      toast({ title: `Duplicated as ${data.ref}`, description: 'A new draft proposal was created from this one.' })
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

  const openEdit = (p: Omit<ProposalListItem, '_count'>) => {
    setEditing(null)
    setDetailId(null)
    qc.fetchQuery({
      queryKey: ['proposal', p.id],
      queryFn: () => get<ProposalDetail>(`/api/proposals/${p.id}`),
    }).then((d) => {
      setForm({
        thirdPartyId: d.thirdParty.id,
        date: toDateInput(d.date),
        validUntil: toDateInput(d.validUntil),
        notes: d.notes ?? '',
        lines: toEditorLines(d.lines),
      })
      setEditing(d)
      setCreateOpen(true)
    })
  }

  const submitForm = () => {
    if (!form.thirdPartyId) {
      toast({ title: 'Third party required', description: 'Choose a customer or prospect.', variant: 'destructive' })
      return
    }
    const usable = form.lines.filter((l) => l.label.trim().length > 0)
    if (usable.length === 0) {
      toast({ title: 'At least one line required', description: 'Add a product or a free line.', variant: 'destructive' })
      return
    }
    if (usable.some((l) => !(l.qty > 0))) {
      toast({ title: 'Invalid quantity', description: 'Quantities must be greater than 0.', variant: 'destructive' })
      return
    }
    saveMut.mutate(form)
  }

  /** Open the print dialog for a proposal (reuses the detail query cache). */
  const openPrint = (p: Pick<ProposalListItem, 'id'>) => {
    qc.fetchQuery({
      queryKey: ['proposal', p.id],
      queryFn: () => get<ProposalDetail>(`/api/proposals/${p.id}`),
    }).then((d) => {
      const orderRef = saleOrdersLite.find((o) => o.proposalId === d.id)?.ref
      setPrintData(buildPrintData(d, orderRef))
      setPrintOpen(true)
    })
  }

  /** Actions available for a given status — shared by row menu + detail footer */
  const availableActions = (p: { id: string; status: string }) => {
    const act = (action: string, label: string, icon: React.ReactNode, destructive = false) => (
      <DropdownMenuItem
        key={action}
        disabled={busy}
        className={destructive ? 'text-destructive focus:text-destructive' : undefined}
        onSelect={() => actionMut.mutate({ id: p.id, action })}
      >
        {icon}
        {label}
      </DropdownMenuItem>
    )
    const items: React.ReactNode[] = []
    items.push(
      <DropdownMenuItem key="print" onSelect={() => openPrint(p)}>
        <Printer className="h-4 w-4" />
        Print / PDF
      </DropdownMenuItem>
    )
    if (p.status === 'DRAFT') {
      items.push(act('validate', 'Validate', <CheckCircle2 className="h-4 w-4" />))
    }
    if (p.status === 'VALIDATED') {
      items.push(act('accept', 'Mark accepted', <Handshake className="h-4 w-4" />))
      items.push(act('refuse', 'Refuse', <XCircle className="h-4 w-4" />, true))
    }
    if (p.status === 'ACCEPTED' || p.status === 'VALIDATED') {
      items.push(
        act('convert_to_order', 'Convert to sale order', <ArrowRightLeft className="h-4 w-4" />)
      )
    }
    if (['DRAFT', 'VALIDATED', 'ACCEPTED', 'REFUSED'].includes(p.status)) {
      items.push(act('close', 'Close', <Archive className="h-4 w-4" />))
    }
    items.push(
      <DropdownMenuItem key="duplicate" disabled={busy} onSelect={() => duplicateMut.mutate(p.id)}>
        <Copy className="h-4 w-4" />
        Duplicate
      </DropdownMenuItem>
    )
    if (p.status === 'DRAFT') {
      items.push(
        <DropdownMenuSeparator key="sep-del" />,
        <DropdownMenuItem
          key="delete"
          disabled={busy}
          className="text-destructive focus:text-destructive"
          onSelect={() => deleteMut.mutate(p.id)}
        >
          <Trash2 className="h-4 w-4" />
          Delete draft
        </DropdownMenuItem>
      )
    }
    return items
  }

  const convertedOrder = detail ? saleOrdersLite.find((o) => o.proposalId === detail.id) : undefined

  return (
    <div className="space-y-5">
      <PageHeader
        icon={FileText}
        title="Commercial proposals"
        description="Quotes sent to prospects and customers — validate, accept and convert to orders."
        actions={
          <Button onClick={openCreate} className="h-10">
            <Plus className="h-4 w-4" /> New proposal
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="Validated pipeline"
          value={stats.validatedValue}
          isMoney
          icon={TrendingUp}
          tone="default"
          hint="Total of proposals awaiting decision"
        />
        <StatCard
          title="Accepted this month"
          value={stats.acceptedThisMonth}
          icon={Handshake}
          tone="success"
          hint="Proposals signed since the 1st"
        />
        <StatCard
          title="Converted to orders"
          value={stats.conversions}
          icon={ArrowRightLeft}
          hint="Lifetime proposal → order conversions"
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search ref, client or notes…"
          className="sm:max-w-xs"
          aria-label="Search proposals"
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

      {/* Table */}
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
                icon={FileText}
                title="No proposals found"
                description="Create your first commercial proposal to start tracking quotes."
                actionLabel="New proposal"
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
                    <TableHead>Third party</TableHead>
                    <TableHead>Valid until</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-28 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((p) => (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => setDetailId(p.id)}>
                      <TableCell className="font-medium tabular-nums">{p.ref}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(p.date)}</TableCell>
                      <TableCell className="max-w-48 truncate">{p.thirdParty.name}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(p.validUntil)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatMoney(p.total)}
                      </TableCell>
                      <TableCell>
                        <DocStatusBadge status={p.status} />
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="relative h-9 w-9 before:absolute before:-inset-1.5"
                            onClick={() => setDetailId(p.id)}
                            aria-label={`View ${p.ref}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {p.status === 'DRAFT' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="relative h-9 w-9 before:absolute before:-inset-1.5"
                              onClick={() => openEdit(p)}
                              aria-label={`Edit ${p.ref}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="relative h-9 w-9 before:absolute before:-inset-1.5"
                                aria-label={`Actions for ${p.ref}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              {availableActions(p)}
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
      <Dialog open={createOpen} onOpenChange={(o) => (o ? setCreateOpen(true) : (setCreateOpen(false), setEditing(null)))}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit proposal ${editing.ref}` : 'New commercial proposal'}</DialogTitle>
            <DialogDescription>
              Pick a third party, add line items from the catalog, then validate to send it.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-1">
                <Label htmlFor="pr-tp">Third party *</Label>
                <Select
                  value={form.thirdPartyId}
                  onValueChange={(v) => setForm((f) => ({ ...f, thirdPartyId: v }))}
                >
                  <SelectTrigger id="pr-tp" className="w-full" aria-label="Third party">
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
                <Label htmlFor="pr-date">Date</Label>
                <Input
                  id="pr-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-valid">Valid until</Label>
                <Input
                  id="pr-valid"
                  type="date"
                  value={form.validUntil}
                  onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
                />
              </div>
            </div>

            <LineEditor
              lines={form.lines}
              onChange={(lines) => setForm((f) => ({ ...f, lines }))}
              products={products}
            />

            <div className="space-y-1.5">
              <Label htmlFor="pr-notes">Notes</Label>
              <Textarea
                id="pr-notes"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Internal or customer-facing notes…"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCreateOpen(false); setEditing(null) }} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={busy}>
              {editing ? 'Save changes' : 'Create proposal'}
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
                  {detail.thirdParty.name} ({detail.thirdParty.code}) · {detail.lines.length} line
                  {detail.lines.length === 1 ? '' : 's'}
                </DialogDescription>
              </DialogHeader>

              <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Date</dt>
                    <dd>{formatDate(detail.date)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Valid until</dt>
                    <dd className="flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                      {formatDate(detail.validUntil)}
                      <span className="text-xs text-muted-foreground">({relativeDays(detail.validUntil)})</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Total</dt>
                    <dd className="font-semibold text-primary">{formatMoney(detail.total)}</dd>
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
                        <TableHead className="text-right">Disc %</TableHead>
                        <TableHead className="text-right">VAT %</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.lines.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell>{l.label}</TableCell>
                          <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(l.unitPrice)}</TableCell>
                          <TableCell className="text-right tabular-nums">{l.discountPct}</TableCell>
                          <TableCell className="text-right tabular-nums">{l.vatRate}%</TableCell>
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
                    <dt className="text-muted-foreground">Discount</dt>
                    <dd className="tabular-nums text-amber-600">−{formatMoney(detail.discountTotal)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">VAT</dt>
                    <dd className="tabular-nums">{formatMoney(detail.vatTotal)}</dd>
                  </div>
                  <div className="flex justify-between border-t pt-1 font-semibold">
                    <dt>Total</dt>
                    <dd className="tabular-nums text-primary">{formatMoney(detail.total)}</dd>
                  </div>
                </dl>
              </div>

              <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
                <div>
                  {convertedOrder && (
                    <Button variant="secondary" onClick={() => { setDetailId(null); navigate('sale-orders') }}>
                      <ArrowRightLeft className="h-4 w-4" />
                      View sale order {convertedOrder.ref}
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
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => actionMut.mutate({ id: detail.id, action: 'validate' })}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Validate
                    </Button>
                  )}
                  {detail.status === 'DRAFT' && (
                    <Button size="sm" variant="outline" onClick={() => openEdit(detail)} disabled={busy}>
                      <Pencil className="h-4 w-4" /> Edit
                    </Button>
                  )}
                  {detail.status === 'VALIDATED' && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => actionMut.mutate({ id: detail.id, action: 'accept' })}
                    >
                      <Handshake className="h-4 w-4" /> Accept
                    </Button>
                  )}
                  {detail.status === 'VALIDATED' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => actionMut.mutate({ id: detail.id, action: 'refuse' })}
                    >
                      <XCircle className="h-4 w-4" /> Refuse
                    </Button>
                  )}
                  {(detail.status === 'ACCEPTED' || detail.status === 'VALIDATED') && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => actionMut.mutate({ id: detail.id, action: 'convert_to_order' })}
                    >
                      <ArrowRightLeft className="h-4 w-4" /> Convert to order
                    </Button>
                  )}
                  {['DRAFT', 'VALIDATED', 'ACCEPTED', 'REFUSED'].includes(detail.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => actionMut.mutate({ id: detail.id, action: 'close' })}
                    >
                      <Archive className="h-4 w-4" /> Close
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
                  {!['DRAFT', 'VALIDATED', 'ACCEPTED', 'REFUSED'].includes(detail.status) && !convertedOrder && (
                    <p className="mr-1 text-xs text-muted-foreground">No further actions for this proposal.</p>
                  )}
                </div>
              </DialogFooter>
            </>
          ) : (
            <div className="space-y-3 py-4" aria-busy="true">
              <DialogTitle className="sr-only">Loading proposal…</DialogTitle>
              <DialogDescription className="sr-only">Fetching proposal details.</DialogDescription>
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {printData && (
        <DocumentPrintDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          kind="PROPOSAL"
          data={printData}
        />
      )}
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  CalendarClock,
  CircleCheck,
  Eye,
  Landmark,
  MoreVertical,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { get, post, put, del } from '@/components/erp/lib/api'
import { PageHeader, EmptyState } from '@/components/erp/shared/page-header'
import { DocStatusBadge } from '@/components/erp/shared/status-badge'
import { StatCard } from '@/components/erp/shared/stat-card'
import { formatDate, formatMoney, toDateInput } from '@/components/erp/shared/format'
import { useToast } from '@/hooks/use-toast'

// ---------------------------------------------------------------------------
// Types (mirroring API payloads)
// ---------------------------------------------------------------------------
interface ThirdPartyLite {
  id: string
  name: string
  code: string
  type?: string
  status?: string
}

interface PurchaseOrderLite {
  id: string
  ref: string
  status: string
  total: number
  thirdParty: { id: string; name: string; code: string }
}

interface PaymentLite {
  id: string
  amount: number
  method: string
  date: string
  reference: string | null
  note: string | null
  bankAccountId: string | null
}

interface SupplierInvoice {
  id: string
  ref: string
  status: string
  date: string
  dueDate: string | null
  subtotal: number
  vatTotal: number
  total: number
  paidAmount: number
  notes: string | null
  thirdParty: ThirdPartyLite
  purchaseOrder?: { id: string; ref: string } | null
  payments?: PaymentLite[]
}

interface BankAccountLite {
  id: string
  name: string
  currentBalance: number
  type: string
}

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PARTIAL', label: 'Partially paid' },
  { value: 'PAID', label: 'Paid' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const

const PAYMENT_METHODS = [
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'CHECK', label: 'Check' },
  { value: 'OTHER', label: 'Other' },
] as const

const NO_PO = '__none__'
const NO_BANK = '__none__'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function isOverdue(inv: SupplierInvoice, now = Date.now()): boolean {
  return (
    ['UNPAID', 'PARTIAL'].includes(inv.status) &&
    !!inv.dueDate &&
    new Date(inv.dueDate).getTime() < now
  )
}

// ---------------------------------------------------------------------------
// Create / Edit dialog — totals entered directly (no line items)
// ---------------------------------------------------------------------------
function SIFormInner({
  editInvoice,
  suppliers,
  receivedOrders,
  saving,
  onSubmit,
  onCancel,
}: {
  editInvoice: SupplierInvoice | null
  suppliers: ThirdPartyLite[]
  receivedOrders: PurchaseOrderLite[]
  saving: boolean
  onSubmit: (payload: unknown) => void
  onCancel: () => void
}) {
  const [supplierId, setSupplierId] = useState(editInvoice?.thirdParty.id ?? '')
  const [date, setDate] = useState(editInvoice ? toDateInput(editInvoice.date) : toDateInput(new Date()))
  const [dueDate, setDueDate] = useState(editInvoice?.dueDate ? toDateInput(editInvoice.dueDate) : '')
  const [subtotal, setSubtotal] = useState(editInvoice ? String(editInvoice.subtotal) : '0')
  const [vatTotal, setVatTotal] = useState(editInvoice ? String(editInvoice.vatTotal) : '0')
  const [purchaseOrderId, setPurchaseOrderId] = useState(editInvoice?.purchaseOrder?.id ?? NO_PO)
  const [notes, setNotes] = useState(editInvoice?.notes ?? '')

  const nSubtotal = Number(subtotal) || 0
  const nVat = Number(vatTotal) || 0
  const computedTotal = round2(nSubtotal + nVat)
  const invalid = !supplierId || nSubtotal < 0 || nVat < 0

  const submit = () => {
    if (!supplierId) return
    onSubmit({
      thirdPartyId: supplierId,
      date: date || undefined,
      dueDate: dueDate || null,
      subtotal: nSubtotal,
      vatTotal: nVat,
      notes: notes || null,
      purchaseOrderId: purchaseOrderId === NO_PO ? null : purchaseOrderId,
    })
  }

  return (
    <>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="si-supplier">Supplier *</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger id="si-supplier" aria-label="Supplier" className="min-h-[40px]">
                <SelectValue placeholder="Select supplier" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="si-po">Linked purchase order</Label>
            <Select value={purchaseOrderId} onValueChange={setPurchaseOrderId}>
              <SelectTrigger id="si-po" aria-label="Linked purchase order" className="min-h-[40px]">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PO}>None</SelectItem>
                {receivedOrders.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.ref} — {o.thirdParty.name} ({formatMoney(o.total)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="si-date">Invoice date</Label>
            <Input id="si-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="si-due">Payment due</Label>
            <Input id="si-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="si-subtotal">Subtotal (net) *</Label>
            <Input
              id="si-subtotal"
              type="number"
              min="0"
              step="0.01"
              value={subtotal}
              onChange={(e) => setSubtotal(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="si-vat">VAT total *</Label>
            <Input
              id="si-vat"
              type="number"
              min="0"
              step="0.01"
              value={vatTotal}
              onChange={(e) => setVatTotal(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-4 py-3">
          <span className="text-sm text-muted-foreground">Total (subtotal + VAT)</span>
          <span className="text-lg font-bold tabular-nums text-primary">{formatMoney(computedTotal)}</span>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="si-notes">Notes</Label>
          <Textarea id="si-notes" rows={2} placeholder="Internal notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit} disabled={saving || invalid} className="min-h-[40px] min-w-[120px]">
          {saving ? 'Saving…' : editInvoice ? 'Save changes' : 'Create draft'}
        </Button>
      </DialogFooter>
    </>
  )
}

function SIFormDialog({
  open,
  onOpenChange,
  suppliers,
  receivedOrders,
  editId,
  editInvoice,
  toast,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  suppliers: ThirdPartyLite[]
  receivedOrders: PurchaseOrderLite[]
  editId: string | null
  editInvoice: SupplierInvoice | null
  toast: ReturnType<typeof useToast>['toast']
}) {
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: (payload: unknown) =>
      editId
        ? put<SupplierInvoice>(`/api/supplier-invoices/${editId}`, payload)
        : post<SupplierInvoice>('/api/supplier-invoices', payload),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['supplier-invoices'] })
      if (editId) queryClient.invalidateQueries({ queryKey: ['supplier-invoice', editId] })
      toast({ title: editId ? 'Supplier invoice updated' : 'Supplier invoice created', description: saved.ref })
      onOpenChange(false)
    },
    onError: (e: Error) =>
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  })

  const loadingEdit = !!editId && !editInvoice

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editId ? `Edit ${editInvoice?.ref ?? 'supplier invoice'}` : 'New supplier invoice'}</DialogTitle>
          <DialogDescription>
            {editId
              ? 'Draft supplier invoices only — totals are recomputed on save.'
              : 'Enter the invoice totals directly (no line items).'}
          </DialogDescription>
        </DialogHeader>

        {loadingEdit ? (
          <div className="space-y-3 py-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <SIFormInner
            key={editId ?? 'new'}
            editInvoice={editInvoice}
            suppliers={suppliers}
            receivedOrders={receivedOrders}
            saving={saveMutation.isPending}
            onSubmit={(payload) => saveMutation.mutate(payload)}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Record payment dialog — posts to /api/payments (contract by agent 6-c)
// ---------------------------------------------------------------------------
function PaymentDialog({
  invoice,
  bankAccounts,
  open,
  onOpenChange,
  toast,
}: {
  invoice: SupplierInvoice
  bankAccounts: BankAccountLite[]
  open: boolean
  onOpenChange: (o: boolean) => void
  toast: ReturnType<typeof useToast>['toast']
}) {
  const queryClient = useQueryClient()
  const remaining = round2(invoice.total - invoice.paidAmount)
  const [amount, setAmount] = useState(String(remaining))
  const [method, setMethod] = useState('BANK_TRANSFER')
  const [date, setDate] = useState(toDateInput(new Date()))
  const [reference, setReference] = useState('')
  const [bankAccountId, setBankAccountId] = useState(NO_BANK)
  const [note, setNote] = useState('')

  const payMutation = useMutation({
    mutationFn: (payload: unknown) => post<PaymentLite>('/api/payments', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-invoices'] })
      queryClient.invalidateQueries({ queryKey: ['supplier-invoice', invoice.id] })
      toast({ title: 'Payment recorded', description: `${formatMoney(Number(amount))} applied to ${invoice.ref}` })
      onOpenChange(false)
    },
    onError: (e: Error) =>
      toast({ title: 'Payment failed', description: e.message, variant: 'destructive' }),
  })

  const submit = () => {
    const nAmount = Number(amount)
    if (!Number.isFinite(nAmount) || nAmount <= 0) {
      toast({ title: 'Invalid amount', description: 'Payment amount must be greater than 0.', variant: 'destructive' })
      return
    }
    payMutation.mutate({
      supplierInvoiceId: invoice.id,
      amount: nAmount,
      method,
      date: date || undefined,
      reference: reference || undefined,
      note: note || undefined,
      bankAccountId: bankAccountId === NO_BANK ? undefined : bankAccountId,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record payment — {invoice.ref}</DialogTitle>
          <DialogDescription>
            {invoice.thirdParty.name} · Total {formatMoney(invoice.total)} · Remaining{' '}
            <span className="font-semibold text-primary">{formatMoney(remaining)}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount *</Label>
            <Input
              id="pay-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-method">Method *</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="pay-method" aria-label="Payment method" className="min-h-[40px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-date">Payment date</Label>
            <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-ref">Reference</Label>
            <Input id="pay-ref" placeholder="e.g. TRX-99120" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pay-bank">Bank account (optional)</Label>
            <Select value={bankAccountId} onValueChange={setBankAccountId}>
              <SelectTrigger id="pay-bank" aria-label="Bank account" className="min-h-[40px]">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_BANK}>None</SelectItem>
                {bankAccounts.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {bankAccounts.length === 0 && (
              <p className="text-xs text-muted-foreground">No bank accounts available.</p>
            )}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pay-note">Note</Label>
            <Input id="pay-note" placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={payMutation.isPending} className="min-h-[40px] min-w-[140px]">
            {payMutation.isPending ? 'Recording…' : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Detail dialog — meta + totals + payments + actions
// ---------------------------------------------------------------------------
function SIDetailDialog({
  invoice,
  isLoading,
  open,
  onOpenChange,
  onAction,
  onEdit,
  onPay,
}: {
  invoice: SupplierInvoice | null
  isLoading: boolean
  open: boolean
  onOpenChange: (o: boolean) => void
  onAction: (inv: SupplierInvoice, action: 'validate' | 'cancel') => void
  onEdit: (inv: SupplierInvoice) => void
  onPay: (inv: SupplierInvoice) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-primary">{invoice?.ref ?? '…'}</span>
            {invoice && <DocStatusBadge status={invoice.status} />}
          </DialogTitle>
          <DialogDescription>Supplier invoice details</DialogDescription>
        </DialogHeader>

        {isLoading || !invoice ? (
          <div className="space-y-3 py-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-x-6 gap-y-2 rounded-md border p-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Supplier</p>
                <p className="font-medium">{invoice.thirdParty.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{invoice.thirdParty.code}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Linked purchase order</p>
                <p className="font-medium font-mono">{invoice.purchaseOrder?.ref ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Invoice date</p>
                <p className="font-medium">{formatDate(invoice.date)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Payment due</p>
                <p className="font-medium">
                  {formatDate(invoice.dueDate)}
                  {isOverdue(invoice) && (
                    <span className="ml-2 inline-block rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700">
                      Overdue
                    </span>
                  )}
                </p>
              </div>
              {invoice.notes && (
                <div className="sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-wrap">{invoice.notes}</p>
                </div>
              )}
            </div>

            <div className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatMoney(invoice.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">VAT</span>
                <span className="tabular-nums">{formatMoney(invoice.vatTotal)}</span>
              </div>
              <div className="flex justify-between border-t pt-1.5 text-base font-bold">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(invoice.total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paid</span>
                <span className="tabular-nums text-emerald-700">{formatMoney(invoice.paidAmount)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span className="text-muted-foreground">Remaining</span>
                <span className="tabular-nums text-primary">{formatMoney(round2(invoice.total - invoice.paidAmount))}</span>
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold">Payments</p>
              {invoice.payments && invoice.payments.length > 0 ? (
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoice.payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="whitespace-nowrap">{formatDate(p.date)}</TableCell>
                          <TableCell className="capitalize">{p.method.replaceAll('_', ' ').toLowerCase()}</TableCell>
                          <TableCell className="font-mono text-xs">{p.reference ?? '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(p.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  No payments recorded yet.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t pt-3">
              {invoice.status === 'DRAFT' && (
                <>
                  <Button size="sm" className="min-h-[40px]" onClick={() => onAction(invoice, 'validate')}>
                    <CircleCheck className="h-4 w-4" /> Validate
                  </Button>
                  <Button size="sm" variant="outline" className="min-h-[40px]" onClick={() => onEdit(invoice)}>
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                </>
              )}
              {['UNPAID', 'PARTIAL'].includes(invoice.status) && (
                <Button size="sm" className="min-h-[40px]" onClick={() => onPay(invoice)}>
                  <Landmark className="h-4 w-4" /> Record payment
                </Button>
              )}
              {['DRAFT', 'UNPAID', 'PARTIAL'].includes(invoice.status) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-[40px] text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  onClick={() => onAction(invoice, 'cancel')}
                >
                  Cancel invoice
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
export default function SupplierInvoicesModule() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [payInvoice, setPayInvoice] = useState<SupplierInvoice | null>(null)

  // ---- Data ---------------------------------------------------------------
  const listQuery = useQuery({
    queryKey: ['supplier-invoices'],
    queryFn: () => get<SupplierInvoice[]>('/api/supplier-invoices'),
  })

  const suppliersQuery = useQuery({
    queryKey: ['third-parties', 'suppliers'],
    queryFn: () => get<ThirdPartyLite[]>('/api/third-parties'),
  })

  const receivedQuery = useQuery({
    queryKey: ['purchase-orders', 'received'],
    queryFn: () => get<PurchaseOrderLite[]>('/api/purchase-orders?status=RECEIVED'),
  })

  // Bank accounts — fail silently and omit the list if unavailable.
  const bankQuery = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: async () => {
      try {
        const res = await get<{ accounts?: BankAccountLite[] } | BankAccountLite[]>('/api/bank')
        return Array.isArray(res) ? res : (res.accounts ?? [])
      } catch {
        return [] as BankAccountLite[]
      }
    },
    retry: false,
  })

  const detailQuery = useQuery({
    queryKey: ['supplier-invoice', detailId],
    queryFn: () => get<SupplierInvoice>(`/api/supplier-invoices/${detailId}`),
    enabled: !!detailId,
  })

  const suppliers = useMemo(
    () =>
      (suppliersQuery.data ?? []).filter(
        (t) => ['SUPPLIER', 'CUSTOMER_SUPPLIER'].includes(t.type ?? '') && t.status !== 'SUSPENDED'
      ),
    [suppliersQuery.data]
  )
  const bankAccounts = bankQuery.data ?? []
  const invoices = listQuery.data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return invoices.filter((inv) => {
      if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false
      if (!q) return true
      return (
        inv.ref.toLowerCase().includes(q) ||
        inv.thirdParty.name.toLowerCase().includes(q) ||
        (inv.purchaseOrder?.ref.toLowerCase().includes(q) ?? false)
      )
    })
  }, [invoices, search, statusFilter])

  // ---- Stats --------------------------------------------------------------
  const stats = useMemo(() => {
    const now = Date.now()
    let unpaidTotal = 0
    let overdueCount = 0
    let paidTotal = 0
    for (const inv of invoices) {
      if (inv.status === 'UNPAID' || inv.status === 'PARTIAL') {
        unpaidTotal += inv.total - inv.paidAmount
        if (inv.dueDate && new Date(inv.dueDate).getTime() < now) overdueCount += 1
      }
      if (inv.status !== 'CANCELLED') paidTotal += inv.paidAmount
    }
    return { unpaidTotal: round2(unpaidTotal), overdueCount, paidTotal: round2(paidTotal) }
  }, [invoices])

  // ---- Mutations ----------------------------------------------------------
  const actMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'validate' | 'cancel' }) =>
      put<SupplierInvoice>(`/api/supplier-invoices/${id}`, { action }),
    onSuccess: (updated, vars) => {
      queryClient.invalidateQueries({ queryKey: ['supplier-invoices'] })
      queryClient.invalidateQueries({ queryKey: ['supplier-invoice'] })
      toast({
        title: vars.action === 'validate' ? 'Supplier invoice validated' : 'Supplier invoice cancelled',
        description: updated.ref,
      })
    },
    onError: (e: Error) =>
      toast({ title: 'Action failed', description: e.message, variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => del<{ id: string }>(`/api/supplier-invoices/${id}`),
    onSuccess: (_res, id) => {
      queryClient.invalidateQueries({ queryKey: ['supplier-invoices'] })
      queryClient.removeQueries({ queryKey: ['supplier-invoice', id] })
      toast({ title: 'Supplier invoice deleted' })
    },
    onError: (e: Error) =>
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' }),
  })

  // ---- Confirm dialog -----------------------------------------------------
  interface ConfirmRequest {
    title: string
    description: string
    confirmLabel: string
    destructive?: boolean
    onConfirm: () => void
  }
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)

  const handleAction = (inv: SupplierInvoice, action: 'validate' | 'cancel') => {
    if (action === 'validate') {
      setConfirmReq({
        title: `Validate ${inv.ref}?`,
        description: 'The supplier invoice will be marked as Unpaid and ready for payments.',
        confirmLabel: 'Validate',
        onConfirm: () => actMutation.mutate({ id: inv.id, action: 'validate' }),
      })
    } else {
      setConfirmReq({
        title: `Cancel ${inv.ref}?`,
        description: 'The supplier invoice will be cancelled. This cannot be undone.',
        confirmLabel: 'Cancel invoice',
        destructive: true,
        onConfirm: () => actMutation.mutate({ id: inv.id, action: 'cancel' }),
      })
    }
  }

  const handleDelete = (inv: SupplierInvoice) => {
    setConfirmReq({
      title: `Delete ${inv.ref}?`,
      description: 'Only draft supplier invoices can be deleted. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => deleteMutation.mutate(inv.id),
    })
  }

  const openEdit = (inv: SupplierInvoice) => {
    setEditId(inv.id)
    setFormOpen(true)
  }
  const openCreate = () => {
    setEditId(null)
    setFormOpen(true)
  }
  const openDetail = (inv: SupplierInvoice) => {
    setDetailId(inv.id)
    setDetailOpen(true)
  }

  const rowActions = (inv: SupplierInvoice) => (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        aria-label={`View ${inv.ref}`}
        onClick={() => openDetail(inv)}
      >
        <Eye className="h-4 w-4" />
      </Button>
      {inv.status === 'DRAFT' && (
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Edit ${inv.ref}`} onClick={() => openEdit(inv)}>
          <Pencil className="h-4 w-4" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`More actions for ${inv.ref}`}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {inv.status === 'DRAFT' && (
            <DropdownMenuItem onClick={() => handleAction(inv, 'validate')}>
              <CircleCheck className="h-4 w-4" /> Validate
            </DropdownMenuItem>
          )}
          {['UNPAID', 'PARTIAL'].includes(inv.status) && (
            <DropdownMenuItem onClick={() => setPayInvoice(inv)}>
              <Landmark className="h-4 w-4" /> Record payment
            </DropdownMenuItem>
          )}
          {inv.status === 'DRAFT' && (
            <DropdownMenuItem onClick={() => openEdit(inv)}>
              <Pencil className="h-4 w-4" /> Edit
            </DropdownMenuItem>
          )}
          {['DRAFT', 'UNPAID', 'PARTIAL'].includes(inv.status) && (
            <DropdownMenuItem className="text-rose-600 focus:text-rose-700" onClick={() => handleAction(inv, 'cancel')}>
              <Trash2 className="h-4 w-4" /> Cancel
            </DropdownMenuItem>
          )}
          {inv.status === 'DRAFT' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-rose-600 focus:text-rose-700" onClick={() => handleDelete(inv)}>
                <Trash2 className="h-4 w-4" /> Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Supplier Invoices"
        description="Track supplier bills, due dates and record payments."
        icon={ReceiptText}
        actions={
          <Button onClick={openCreate} className="min-h-[40px]">
            <Plus className="h-4 w-4" /> New supplier invoice
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Unpaid total"
          value={stats.unpaidTotal}
          isMoney
          hint="Outstanding on unpaid + partial invoices"
          icon={AlertCircle}
          tone="warning"
        />
        <StatCard
          title="Overdue invoices"
          value={stats.overdueCount}
          hint="Due date passed, not fully paid"
          icon={CalendarClock}
          tone="danger"
        />
        <StatCard
          title="Total paid"
          value={stats.paidTotal}
          isMoney
          hint="Payments applied to supplier invoices"
          icon={CircleCheck}
          tone="success"
        />
      </div>

      {/* Toolbar + table */}
      <Card className="py-0 gap-0">
        <CardContent className="p-4 sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                className="min-h-[40px] pl-9"
                placeholder="Search ref, supplier or PO…"
                aria-label="Search supplier invoices"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {listQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={ReceiptText}
              title="No supplier invoices"
              description={invoices.length === 0 ? 'Record your first supplier bill to track what you owe.' : 'No invoices match your filters.'}
              actionLabel={invoices.length === 0 ? 'New supplier invoice' : undefined}
              onAction={invoices.length === 0 ? openCreate : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[980px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>PO</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-sm font-semibold text-primary">{inv.ref}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(inv.date)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(inv.dueDate)}
                        {isOverdue(inv) && (
                          <span className="ml-2 inline-block rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700">
                            Overdue
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{inv.thirdParty.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {inv.purchaseOrder?.ref ?? '—'}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatMoney(inv.total)}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">
                        {formatMoney(inv.paidAmount)}
                      </TableCell>
                      <TableCell>
                        <DocStatusBadge status={inv.status} />
                      </TableCell>
                      <TableCell>{rowActions(inv)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / edit */}
      <SIFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        suppliers={suppliers}
        receivedOrders={receivedQuery.data ?? []}
        editId={editId}
        editInvoice={editId ? (detailQuery.data ?? null) : null}
        toast={toast}
      />

      {/* Detail */}
      <SIDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        invoice={detailQuery.data ?? null}
        isLoading={detailQuery.isLoading}
        onAction={handleAction}
        onEdit={(inv) => {
          setDetailOpen(false)
          openEdit(inv)
        }}
        onPay={(inv) => setPayInvoice(inv)}
      />

      {/* Record payment */}
      {payInvoice && (
        <PaymentDialog
          key={payInvoice.id}
          invoice={payInvoice}
          bankAccounts={bankAccounts}
          open={!!payInvoice}
          onOpenChange={(o) => !o && setPayInvoice(null)}
          toast={toast}
        />
      )}

      {/* Confirm */}
      <AlertDialog open={!!confirmReq} onOpenChange={(o) => !o && setConfirmReq(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmReq?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmReq?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={confirmReq?.destructive ? 'bg-rose-600 text-white hover:bg-rose-700' : ''}
              onClick={() => {
                confirmReq?.onConfirm()
                setConfirmReq(null)
              }}
            >
              {confirmReq?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

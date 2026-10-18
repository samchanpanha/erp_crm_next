'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownLeft,
  ArrowUpRight,
  CreditCard,
  Eye,
  MoreHorizontal,
  Plus,
  Printer,
  Receipt,
} from 'lucide-react'

import { get, post } from '../lib/api'
import { EmptyState, PageHeader } from '../shared/page-header'
import { StatusBadge, type Tone } from '../shared/status-badge'
import { StatCard } from '../shared/stat-card'
import { formatMoney, formatDate, toDateInput } from '../shared/format'
import { DocumentPrintDialog, type ReceiptPrintData } from '../shared/print-document'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------
interface InvoiceRef {
  id: string
  ref: string
  status: string
  total: number
  paidAmount: number
  thirdParty: {
    id: string
    name: string
    // Enriched fields returned by /api/payments for the receipt engine (optional)
    code?: string
    address?: string | null
    zip?: string | null
    city?: string | null
    country?: string | null
    email?: string | null
    phone?: string | null
    vatNumber?: string | null
  }
}

export interface PaymentRow {
  id: string
  amount: number
  method: string
  date: string
  reference: string | null
  note: string | null
  bankAccountId: string | null
  invoice: InvoiceRef | null
  supplierInvoice: InvoiceRef | null
}

interface OpenInvoice {
  id: string
  ref: string
  status: string
  total: number
  paidAmount: number
  thirdParty?: { id: string; name: string }
}

export interface PaymentTarget {
  id: string
  ref: string
  thirdPartyName: string
  remaining: number
}

interface BankAccount {
  id: string
  name: string
  currentBalance?: number
  type?: string
}

const METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'CHECK', 'OTHER'] as const

const METHOD_META: Record<string, { tone: Tone; label: string }> = {
  CASH: { tone: 'success', label: 'Cash' },
  CARD: { tone: 'info', label: 'Card' },
  BANK_TRANSFER: { tone: 'neutral', label: 'Bank transfer' },
  CHECK: { tone: 'warning', label: 'Check' },
  OTHER: { tone: 'muted', label: 'Other' },
}

export function MethodBadge({ method }: { method: string }) {
  const meta = METHOD_META[method] ?? { tone: 'muted' as Tone, label: method }
  return <StatusBadge label={meta.label} tone={meta.tone} />
}

const remainingOf = (i: OpenInvoice | PaymentTarget): number => {
  if ('remaining' in i) return Math.max(0, Math.round(i.remaining * 100) / 100)
  return Math.max(0, Math.round((i.total - i.paidAmount) * 100) / 100)
}

function normalizeList<T>(raw: unknown, keys: string[]): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    for (const k of keys) if (Array.isArray(obj[k])) return obj[k] as T[]
  }
  return []
}

const isOpen = (i: OpenInvoice) => i.status === 'UNPAID' || i.status === 'PARTIAL'

/** Map a payment row onto the printable receipt shape (remaining = total − paid). */
function buildReceiptData(p: PaymentRow): ReceiptPrintData | null {
  const doc = p.invoice ?? p.supplierInvoice
  if (!doc) return null
  const tp = doc.thirdParty
  return {
    paymentRef: p.reference ?? undefined,
    amount: p.amount,
    method: p.method,
    date: p.date,
    reference: p.reference,
    invoice: { ref: doc.ref, total: doc.total, paidAmount: doc.paidAmount },
    customer: {
      name: tp.name,
      code: tp.code ?? '—',
      address: tp.address ?? null,
      email: tp.email ?? null,
      phone: tp.phone ?? null,
      taxId: tp.vatNumber ?? null,
    },
  }
}

// ---------------------------------------------------------------------------
// RecordPaymentDialog — shared by the Payments module (pick mode) and the
// Invoices module (fixed mode with a prefilled invoice).
// ---------------------------------------------------------------------------
export function RecordPaymentDialog({
  open,
  onOpenChange,
  mode,
  target,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'pick' | 'fixed'
  target?: PaymentTarget | null
  onSaved?: () => void
}) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [kind, setKind] = useState<'customer' | 'supplier'>('customer')
  const [selectedId, setSelectedId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('BANK_TRANSFER')
  const [date, setDate] = useState(toDateInput(new Date()))
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [bankAccountId, setBankAccountId] = useState('')

  const customerQ = useQuery({
    queryKey: ['invoices', 'open-for-payment'],
    enabled: open && mode === 'pick',
    queryFn: async () => {
      try {
        const rows = await get<OpenInvoice[]>('/api/invoices')
        return rows.filter(isOpen)
      } catch {
        return [] as OpenInvoice[]
      }
    },
  })

  const supplierQ = useQuery({
    queryKey: ['supplier-invoices', 'open-for-payment'],
    enabled: open && mode === 'pick',
    queryFn: async () => {
      try {
        const raw = await get<unknown>('/api/supplier-invoices')
        return normalizeList<OpenInvoice>(raw, ['supplierInvoices', 'items', 'data']).filter(isOpen)
      } catch {
        return [] as OpenInvoice[]
      }
    },
  })

  const bankQ = useQuery({
    queryKey: ['bank', 'accounts-for-payment'],
    enabled: open,
    queryFn: async () => {
      try {
        return normalizeList<BankAccount>(await get<unknown>('/api/bank'), ['accounts', 'items', 'data'])
      } catch {
        return [] as BankAccount[]
      }
    },
  })

  const banks = bankQ.data ?? []
  const pickList = kind === 'customer' ? customerQ.data ?? [] : supplierQ.data ?? []
  const selected = pickList.find((i) => i.id === selectedId) ?? null

  const effective: (OpenInvoice | PaymentTarget) | null =
    mode === 'fixed' && target ? target : selected

  const remaining = effective ? remainingOf(effective) : 0

  /** Fresh state for each open — wired into onOpenChange instead of an effect */
  const resetForm = () => {
    setKind('customer')
    setSelectedId('')
    setAmount(mode === 'fixed' && target ? target.remaining.toFixed(2) : '')
    setMethod('BANK_TRANSFER')
    setDate(toDateInput(new Date()))
    setReference('')
    setNote('')
    setBankAccountId('')
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm()
    onOpenChange(nextOpen)
  }

  const payMut = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        amount: Number(amount),
        method,
        date: date || undefined,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        bankAccountId: bankAccountId || undefined,
      }
      if (mode === 'fixed' && target) body.invoiceId = target.id
      else if (kind === 'customer') body.invoiceId = selectedId
      else body.supplierInvoiceId = selectedId
      return post<PaymentRow>('/api/payments', body)
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['invoice'] })
      qc.invalidateQueries({ queryKey: ['supplier-invoices'] })
      qc.invalidateQueries({ queryKey: ['bank'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      const docRef = data.invoice?.ref ?? data.supplierInvoice?.ref ?? ''
      handleOpenChange(false)
      onSaved?.()
      toast({ title: 'Payment recorded', description: `${formatMoney(data.amount)} applied to ${docRef}` })
    },
    onError: (e: Error) => toast({ title: 'Payment failed', description: e.message, variant: 'destructive' }),
  })

  const submit = () => {
    const value = Number(amount)
    if (!effective) {
      toast({ title: 'Select an invoice', description: 'Pick an open invoice to apply the payment to.', variant: 'destructive' })
      return
    }
    if (!(value > 0)) {
      toast({ title: 'Invalid amount', description: 'The payment amount must be greater than 0.', variant: 'destructive' })
      return
    }
    if (value > remaining + 0.005) {
      toast({
        title: 'Amount too high',
        description: `Payment exceeds the remaining balance (${remaining.toFixed(2)} remaining).`,
        variant: 'destructive',
      })
      return
    }
    payMut.mutate()
  }

  const canSubmit = !!effective && Number(amount) > 0 && Number(amount) <= remaining + 0.005 && !payMut.isPending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Apply an incoming or outgoing payment to an open invoice.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {mode === 'pick' && (
            <Tabs
              value={kind}
              onValueChange={(v) => {
                setKind(v as 'customer' | 'supplier')
                setSelectedId('')
                setAmount('')
              }}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="customer">Customer invoice</TabsTrigger>
                <TabsTrigger value="supplier">Supplier invoice</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {mode === 'fixed' && target && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{target.ref}</p>
              <p className="text-muted-foreground">
                {target.thirdPartyName} · Remaining{' '}
                <span className="font-semibold text-primary">{formatMoney(target.remaining)}</span>
              </p>
            </div>
          )}

          {mode === 'pick' && (
            <div className="space-y-1.5">
              <Label htmlFor="pay-invoice">Invoice *</Label>
              <Select
                value={selectedId}
                onValueChange={(v) => {
                  setSelectedId(v)
                  const item = pickList.find((i) => i.id === v)
                  setAmount(item ? remainingOf(item).toFixed(2) : '')
                }}
                disabled={kind === 'customer' ? customerQ.isLoading : supplierQ.isLoading}
              >
                <SelectTrigger id="pay-invoice" className="w-full" aria-label="Invoice">
                  <SelectValue placeholder={pickList.length ? 'Select an open invoice…' : 'No open invoices'} />
                </SelectTrigger>
                <SelectContent>
                  {pickList.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.ref} — {i.thirdParty?.name ?? 'Unknown'} · {formatMoney(remainingOf(i))} due
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount *</Label>
              <Input
                id="pay-amount"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`Max ${remaining.toFixed(2)}`}
                aria-label="Payment amount"
              />
              <p className="text-xs text-muted-foreground">Remaining balance: {formatMoney(remaining)}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-method">Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="pay-method" className="w-full" aria-label="Payment method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {METHOD_META[m].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-date">Date</Label>
              <Input
                id="pay-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-ref">Reference</Label>
              <Input
                id="pay-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="TRX-12345"
              />
            </div>
          </div>

          {banks.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="pay-bank">Bank account (optional)</Label>
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger id="pay-bank" className="w-full" aria-label="Bank account">
                  <SelectValue placeholder="Do not link to a bank account" />
                </SelectTrigger>
                <SelectContent>
                  {banks.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                      {typeof b.currentBalance === 'number' ? ` · ${formatMoney(b.currentBalance)}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Creates a matching bank transaction and updates the account balance.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="pay-note">Note</Label>
            <Textarea
              id="pay-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional memo…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={payMut.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            <CreditCard className="h-4 w-4" />
            {payMut.isPending ? 'Saving…' : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Payments module
// ---------------------------------------------------------------------------
export default function PaymentsModule() {
  const [q, setQ] = useState('')
  const [method, setMethod] = useState('ALL')
  const [payOpen, setPayOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [printData, setPrintData] = useState<ReceiptPrintData | null>(null)

  /** Open the receipt print dialog for a payment row. */
  const openReceipt = (p: PaymentRow) => {
    const data = buildReceiptData(p)
    if (!data) return
    setPrintData(data)
    setPrintOpen(true)
  }

  const listQ = useQuery({
    queryKey: ['payments', q, method],
    queryFn: () =>
      get<PaymentRow[]>(
        `/api/payments?${new URLSearchParams({
          ...(q ? { q } : {}),
          ...(method !== 'ALL' ? { method } : {}),
        }).toString()}`
      ),
  })

  const list = listQ.data ?? []

  const stats = useMemo(() => {
    const received = list.filter((p) => p.invoice).reduce((s, p) => s + p.amount, 0)
    const paidOut = list.filter((p) => p.supplierInvoice).reduce((s, p) => s + p.amount, 0)
    return { received, paidOut, count: list.length }
  }, [list])

  return (
    <div className="space-y-5">
      <PageHeader
        icon={CreditCard}
        title="Payments"
        description="Every payment received from customers and sent to suppliers, in one ledger."
        actions={
          <Button onClick={() => setPayOpen(true)} className="h-10">
            <Plus className="h-4 w-4" /> New payment
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="Total received"
          value={stats.received}
          isMoney
          icon={ArrowDownLeft}
          tone="success"
          hint="Payments on customer invoices"
        />
        <StatCard
          title="Total paid out"
          value={stats.paidOut}
          isMoney
          icon={ArrowUpRight}
          tone="warning"
          hint="Payments on supplier invoices"
        />
        <StatCard title="Payments recorded" value={stats.count} icon={Receipt} hint="All methods, both directions" />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search reference, invoice, client…"
          className="sm:max-w-xs"
          aria-label="Search payments"
        />
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Filter by method">
            <SelectValue placeholder="Method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All methods</SelectItem>
            {METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {METHOD_META[m].label}
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
                icon={CreditCard}
                title="No payments found"
                description="Record a payment against an open customer or supplier invoice."
                actionLabel="New payment"
                onAction={() => setPayOpen(true)}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Applied to</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-14 text-right">
                      <span className="sr-only">Details</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((p) => {
                    const doc = p.invoice ?? p.supplierInvoice
                    const tpName = p.invoice?.thirdParty.name ?? p.supplierInvoice?.thirdParty.name
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap">{formatDate(p.date)}</TableCell>
                        <TableCell className="max-w-40 truncate text-muted-foreground">
                          {p.reference ?? '—'}
                          {p.note && <span className="block max-w-40 truncate text-xs">{p.note}</span>}
                        </TableCell>
                        <TableCell>
                          <MethodBadge method={p.method} />
                        </TableCell>
                        <TableCell>
                          {doc ? (
                            <div className="leading-tight">
                              <span className="font-medium tabular-nums">{doc.ref}</span>
                              <span className="block text-xs text-muted-foreground">{tpName}</span>
                            </div>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell
                          className={`text-right font-semibold tabular-nums ${
                            p.supplierInvoice ? 'text-amber-600' : 'text-emerald-600'
                          }`}
                        >
                          {p.supplierInvoice ? '−' : '+'}
                          {formatMoney(p.amount)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="relative h-9 w-9 before:absolute before:-inset-1.5"
                                aria-label="Payment details"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-64">
                              <DropdownMenuItem className="flex-col items-start gap-0.5" disabled>
                                <span className="text-xs text-muted-foreground">
                                  {p.invoice ? 'Customer payment' : 'Supplier payment'} · {formatDate(p.date)}
                                </span>
                                <span className="text-sm font-medium">{doc?.ref}</span>
                                {doc && (
                                  <span className="text-xs text-muted-foreground">
                                    {formatMoney(doc.paidAmount)} paid of {formatMoney(doc.total)} · {doc.status}
                                  </span>
                                )}
                                {p.note && <span className="text-xs text-muted-foreground">{p.note}</span>}
                              </DropdownMenuItem>
                              {doc && (
                                <DropdownMenuItem onSelect={() => openReceipt(p)}>
                                  <Printer className="h-4 w-4" /> Receipt / PDF
                                </DropdownMenuItem>
                              )}
                              {p.invoice && (
                                <DropdownMenuItem asChild>
                                  <a href="#/invoices" className="flex items-center gap-2">
                                    <Eye className="h-4 w-4" /> Open invoice
                                  </a>
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <RecordPaymentDialog open={payOpen} onOpenChange={setPayOpen} mode="pick" />

      {printData && (
        <DocumentPrintDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          kind="RECEIPT"
          data={printData}
        />
      )}
    </div>
  )
}

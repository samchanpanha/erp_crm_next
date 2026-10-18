'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardCheck,
  Eye,
  MoreVertical,
  PackageCheck,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  Wallet,
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
import { computeLineTotal, computeTotals } from '@/lib/doc-math'
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

interface ProductLite {
  id: string
  ref: string
  label: string
  costPrice: number
  vatRate: number
  unit: string
}

interface POLine {
  id?: string
  productId: string | null
  label: string
  description: string | null
  qty: number
  unitPrice: number
  discountPct: number
  vatRate: number
  sort: number
}

interface PurchaseOrder {
  id: string
  ref: string
  status: string
  date: string
  expectedDate: string | null
  subtotal: number
  discountTotal: number
  vatTotal: number
  total: number
  notes: string | null
  thirdParty: ThirdPartyLite
  lines?: POLine[]
  _count?: { lines: number }
}

type PurchaseOrderDetail = PurchaseOrder & { lines: POLine[] }

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'VALIDATED', label: 'Validated' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'BILLED', label: 'Billed' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const

const NO_PRODUCT = '__none__'

// ---------------------------------------------------------------------------
// Line editor (local) — product select prefills label/cost/vat, editable fields
// ---------------------------------------------------------------------------
interface EditorLine {
  key: string
  productId: string
  label: string
  qty: string
  unitPrice: string
  discountPct: string
  vatRate: string
}

let lineKeySeq = 0
function newEditorLine(): EditorLine {
  lineKeySeq += 1
  return { key: `l${lineKeySeq}`, productId: NO_PRODUCT, label: '', qty: '1', unitPrice: '0', discountPct: '0', vatRate: '20' }
}

function toEditorLines(detail: PurchaseOrderDetail | null): EditorLine[] {
  if (!detail) return [newEditorLine()]
  return detail.lines.map((l) => {
    lineKeySeq += 1
    return {
      key: `l${lineKeySeq}`,
      productId: l.productId ?? NO_PRODUCT,
      label: l.label,
      qty: String(l.qty),
      unitPrice: String(l.unitPrice),
      discountPct: String(l.discountPct),
      vatRate: String(l.vatRate),
    }
  })
}

function parseEditorLine(l: EditorLine) {
  return {
    productId: l.productId === NO_PRODUCT ? null : l.productId,
    label: l.label.trim(),
    qty: Number(l.qty) || 0,
    unitPrice: Number(l.unitPrice) || 0,
    discountPct: Number(l.discountPct) || 0,
    vatRate: Number(l.vatRate) || 0,
  }
}

function POLineEditor({
  lines,
  products,
  onChange,
}: {
  lines: EditorLine[]
  products: ProductLite[]
  onChange: (lines: EditorLine[]) => void
}) {
  const update = (key: string, patch: Partial<EditorLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const remove = (key: string) => onChange(lines.filter((l) => l.key !== key))

  const onProductChange = (line: EditorLine, productId: string) => {
    if (productId === NO_PRODUCT) {
      update(line.key, { productId })
      return
    }
    const p = products.find((x) => x.id === productId)
    update(line.key, {
      productId,
      label: p ? p.label : line.label,
      unitPrice: p ? String(p.costPrice) : line.unitPrice,
      vatRate: p ? String(p.vatRate) : line.vatRate,
    })
  }

  return (
    <div className="rounded-md border">
      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className="grid grid-cols-[200px_1fr_90px_120px_80px_80px_100px_44px] items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>Product</span>
            <span>Description</span>
            <span>Qty</span>
            <span>Unit cost</span>
            <span>Disc %</span>
            <span>VAT %</span>
            <span className="text-right">Total</span>
            <span />
          </div>
          <div className="divide-y">
            {lines.map((l) => {
              const parsed = parseEditorLine(l)
              return (
                <div
                  key={l.key}
                  className="grid grid-cols-[200px_1fr_90px_120px_80px_80px_100px_44px] items-center gap-2 px-3 py-2"
                >
                  <Select value={l.productId} onValueChange={(v) => onProductChange(l, v)}>
                    <SelectTrigger aria-label="Product" className="h-9">
                      <SelectValue placeholder="Free line" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PRODUCT}>Free line</SelectItem>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label="Line description"
                    className="h-9"
                    placeholder="Line description"
                    value={l.label}
                    onChange={(e) => update(l.key, { label: e.target.value })}
                  />
                  <Input
                    aria-label="Quantity"
                    className="h-9"
                    type="number"
                    min="0"
                    step="1"
                    value={l.qty}
                    onChange={(e) => update(l.key, { qty: e.target.value })}
                  />
                  <Input
                    aria-label="Unit cost"
                    className="h-9"
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.unitPrice}
                    onChange={(e) => update(l.key, { unitPrice: e.target.value })}
                  />
                  <Input
                    aria-label="Discount percent"
                    className="h-9"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={l.discountPct}
                    onChange={(e) => update(l.key, { discountPct: e.target.value })}
                  />
                  <Input
                    aria-label="VAT percent"
                    className="h-9"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={l.vatRate}
                    onChange={(e) => update(l.key, { vatRate: e.target.value })}
                  />
                  <span className="text-right text-sm font-medium tabular-nums">
                    {formatMoney(computeLineTotal(parsed))}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-rose-600"
                    aria-label="Remove line"
                    onClick={() => remove(l.key)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="border-t px-3 py-2">
        <Button type="button" variant="outline" size="sm" className="min-h-[36px]" onClick={() => onChange([...lines, newEditorLine()])}>
          <Plus className="h-4 w-4" /> Add line
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Totals box (shared by form + detail)
// ---------------------------------------------------------------------------
function TotalsBox({ lines }: { lines: { qty: number; unitPrice: number; discountPct?: number | null; vatRate?: number | null }[] }) {
  const t = computeTotals(lines)
  return (
    <div className="ml-auto w-full max-w-xs shrink-0 space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Subtotal</span>
        <span className="tabular-nums">{formatMoney(t.subtotal)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Discount</span>
        <span className="tabular-nums">-{formatMoney(t.discountTotal)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">VAT</span>
        <span className="tabular-nums">{formatMoney(t.vatTotal)}</span>
      </div>
      <div className="flex justify-between border-t pt-1.5 text-base font-bold text-primary">
        <span>Total</span>
        <span className="tabular-nums">{formatMoney(t.total)}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create / Edit dialog
// ---------------------------------------------------------------------------
function POFormInner({
  editOrder,
  suppliers,
  products,
  saving,
  onSubmit,
  onCancel,
}: {
  editOrder: PurchaseOrderDetail | null
  suppliers: ThirdPartyLite[]
  products: ProductLite[]
  saving: boolean
  onSubmit: (payload: unknown) => void
  onCancel: () => void
}) {
  const [supplierId, setSupplierId] = useState(editOrder?.thirdParty.id ?? '')
  const [date, setDate] = useState(editOrder ? toDateInput(editOrder.date) : toDateInput(new Date()))
  const [expectedDate, setExpectedDate] = useState(
    editOrder?.expectedDate ? toDateInput(editOrder.expectedDate) : ''
  )
  const [notes, setNotes] = useState(editOrder?.notes ?? '')
  const [lines, setLines] = useState<EditorLine[]>(() => toEditorLines(editOrder))

  const parsedLines = lines.map(parseEditorLine)

  const submit = () => {
    if (!supplierId) return
    onSubmit({
      thirdPartyId: supplierId,
      date: date || undefined,
      expectedDate: expectedDate || null,
      notes: notes || null,
      lines: parsedLines,
    })
  }

  const invalid =
    !supplierId ||
    parsedLines.length === 0 ||
    parsedLines.some((l) => !l.label || l.qty <= 0 || l.unitPrice < 0)

  return (
    <>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="po-supplier">Supplier *</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger id="po-supplier" aria-label="Supplier" className="min-h-[40px]">
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
            <Label htmlFor="po-date">Order date</Label>
            <Input id="po-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="po-expected">Expected delivery</Label>
            <Input id="po-expected" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Lines</Label>
          <POLineEditor lines={lines} products={products} onChange={setLines} />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full space-y-1.5">
            <Label htmlFor="po-notes">Notes</Label>
            <Textarea id="po-notes" rows={2} placeholder="Internal notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <TotalsBox lines={parsedLines} />
        </div>
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit} disabled={saving || invalid} className="min-h-[40px] min-w-[120px]">
          {saving ? 'Saving…' : editOrder ? 'Save changes' : 'Create draft'}
        </Button>
      </DialogFooter>
    </>
  )
}

function POFormDialog({
  open,
  onOpenChange,
  suppliers,
  products,
  editId,
  editOrder,
  toast,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  suppliers: ThirdPartyLite[]
  products: ProductLite[]
  editId: string | null
  editOrder: PurchaseOrderDetail | null
  toast: ReturnType<typeof useToast>['toast']
}) {
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: (payload: unknown) =>
      editId
        ? put<PurchaseOrderDetail>(`/api/purchase-orders/${editId}`, payload)
        : post<PurchaseOrderDetail>('/api/purchase-orders', payload),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      if (editId) queryClient.invalidateQueries({ queryKey: ['purchase-order', editId] })
      toast({ title: editId ? 'Purchase order updated' : 'Purchase order created', description: saved.ref })
      onOpenChange(false)
    },
    onError: (e: Error) =>
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  })

  const submit = (payload: unknown) => {
    if (!editId) {
      const p = payload as { lines: { label: string; qty: number; unitPrice: number }[] }
      if (!p.lines.length || p.lines.some((l) => !l.label || l.qty <= 0 || l.unitPrice < 0)) {
        toast({
          title: 'Invalid line',
          description: 'Every line needs a description, a quantity > 0 and a unit cost >= 0.',
          variant: 'destructive',
        })
        return
      }
    }
    saveMutation.mutate(payload)
  }

  const loadingEdit = !!editId && !editOrder
  const ready = !loadingEdit

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{editId ? `Edit ${editOrder?.ref ?? 'purchase order'}` : 'New purchase order'}</DialogTitle>
          <DialogDescription>
            {editId ? 'Draft purchase orders only — lines are replaced and totals recomputed.' : 'Create a draft supplier order with at least one line.'}
          </DialogDescription>
        </DialogHeader>

        {!ready ? (
          <div className="space-y-3 py-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <POFormInner
            key={editId ?? 'new'}
            editOrder={editOrder}
            suppliers={suppliers}
            products={products}
            saving={saveMutation.isPending}
            onSubmit={submit}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Detail dialog
// ---------------------------------------------------------------------------
function PODetailDialog({
  order,
  isLoading,
  open,
  onOpenChange,
  onAction,
  onEdit,
}: {
  order: PurchaseOrderDetail | null
  isLoading: boolean
  open: boolean
  onOpenChange: (o: boolean) => void
  onAction: (order: PurchaseOrder, action: 'validate' | 'receive' | 'cancel') => void
  onEdit: (order: PurchaseOrder) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-primary">{order?.ref ?? '…'}</span>
            {order && <DocStatusBadge status={order.status} />}
          </DialogTitle>
          <DialogDescription>Purchase order details</DialogDescription>
        </DialogHeader>

        {isLoading || !order ? (
          <div className="space-y-3 py-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-2/3" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-x-6 gap-y-2 rounded-md border p-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Supplier</p>
                <p className="font-medium">{order.thirdParty.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{order.thirdParty.code}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Order date</p>
                <p className="font-medium">{formatDate(order.date)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Expected delivery</p>
                <p className="font-medium">{formatDate(order.expectedDate)}</p>
              </div>
              {order.notes && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-wrap">{order.notes}</p>
                </div>
              )}
            </div>

            <div className="overflow-x-auto rounded-md border">
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit cost</TableHead>
                    <TableHead className="text-right">Disc %</TableHead>
                    <TableHead className="text-right">VAT %</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.lines.map((l) => (
                    <TableRow key={l.id ?? l.label}>
                      <TableCell className="font-medium">{l.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(l.unitPrice)}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.discountPct}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.vatRate}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(computeLineTotal(l))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <TotalsBox lines={order.lines} />

            <div className="flex flex-wrap gap-2 border-t pt-3">
              {order.status === 'DRAFT' && (
                <>
                  <Button size="sm" className="min-h-[40px]" onClick={() => onAction(order, 'validate')}>
                    <ClipboardCheck className="h-4 w-4" /> Validate
                  </Button>
                  <Button size="sm" variant="outline" className="min-h-[40px]" onClick={() => onEdit(order)}>
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                </>
              )}
              {order.status === 'VALIDATED' && (
                <Button size="sm" className="min-h-[40px]" onClick={() => onAction(order, 'receive')}>
                  <PackageCheck className="h-4 w-4" /> Receive goods
                </Button>
              )}
              {['DRAFT', 'VALIDATED'].includes(order.status) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-[40px] text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  onClick={() => onAction(order, 'cancel')}
                >
                  Cancel order
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
export default function PurchaseOrdersModule() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  // ---- Data ---------------------------------------------------------------
  const listQuery = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => get<PurchaseOrder[]>('/api/purchase-orders'),
  })

  const suppliersQuery = useQuery({
    queryKey: ['third-parties', 'suppliers'],
    queryFn: () => get<ThirdPartyLite[]>('/api/third-parties'),
  })

  const productsQuery = useQuery({
    queryKey: ['products', 'active'],
    queryFn: () => get<ProductLite[]>('/api/products?status=ACTIVE'),
  })

  const detailQuery = useQuery({
    queryKey: ['purchase-order', detailId],
    queryFn: () => get<PurchaseOrderDetail>(`/api/purchase-orders/${detailId}`),
    enabled: !!detailId,
  })

  const suppliers = useMemo(
    () =>
      (suppliersQuery.data ?? []).filter(
        (t) => ['SUPPLIER', 'CUSTOMER_SUPPLIER'].includes(t.type ?? '') && t.status !== 'SUSPENDED'
      ),
    [suppliersQuery.data]
  )
  const products = productsQuery.data ?? []
  const orders = listQuery.data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders.filter((o) => {
      if (statusFilter !== 'ALL' && o.status !== statusFilter) return false
      if (!q) return true
      return o.ref.toLowerCase().includes(q) || o.thirdParty.name.toLowerCase().includes(q)
    })
  }, [orders, search, statusFilter])

  // ---- Stats --------------------------------------------------------------
  const stats = useMemo(() => {
    const now = Date.now()
    const open = orders.filter((o) => o.status === 'VALIDATED').length
    const monthAgo = now - 30 * 86400000
    const received30d = orders.filter((o) => o.status === 'RECEIVED' && new Date(o.date).getTime() >= monthAgo).length
    const totalValue = orders
      .filter((o) => o.status !== 'CANCELLED')
      .reduce((s, o) => s + o.total, 0)
    return { open, received30d, totalValue }
  }, [orders])

  // ---- Mutations ----------------------------------------------------------
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
    queryClient.invalidateQueries({ queryKey: ['purchase-order'] })
    queryClient.invalidateQueries({ queryKey: ['stock'] })
  }

  const actMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'validate' | 'receive' | 'cancel' }) =>
      put<PurchaseOrderDetail>(`/api/purchase-orders/${id}`, { action }),
    onSuccess: (updated, vars) => {
      invalidateAll()
      const label = vars.action === 'validate' ? 'Purchase order validated' : vars.action === 'receive' ? 'Stock updated' : 'Purchase order cancelled'
      toast({
        title: label,
        description: vars.action === 'receive' ? `${updated.ref} received — stock IN movements created.` : updated.ref,
      })
    },
    onError: (e: Error) =>
      toast({ title: 'Action failed', description: e.message, variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => del<{ id: string }>(`/api/purchase-orders/${id}`),
    onSuccess: (_res, id) => {
      invalidateAll()
      queryClient.removeQueries({ queryKey: ['purchase-order', id] })
      toast({ title: 'Purchase order deleted' })
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

  const handleAction = (order: PurchaseOrder, action: 'validate' | 'receive' | 'cancel') => {
    if (action === 'validate') {
      setConfirmReq({
        title: `Validate ${order.ref}?`,
        description: 'The purchase order will be marked as Validated and ready for goods receipt.',
        confirmLabel: 'Validate',
        onConfirm: () => actMutation.mutate({ id: order.id, action: 'validate' }),
      })
    } else if (action === 'receive') {
      setConfirmReq({
        title: `Receive goods for ${order.ref}?`,
        description:
          'This will add stock IN movements for every managed product on this order and increase stock quantities. The order will be marked as Received.',
        confirmLabel: 'Receive & update stock',
        onConfirm: () => actMutation.mutate({ id: order.id, action: 'receive' }),
      })
    } else {
      setConfirmReq({
        title: `Cancel ${order.ref}?`,
        description: 'The purchase order will be cancelled. This cannot be undone.',
        confirmLabel: 'Cancel order',
        destructive: true,
        onConfirm: () => actMutation.mutate({ id: order.id, action: 'cancel' }),
      })
    }
  }

  const handleDelete = (order: PurchaseOrder) => {
    setConfirmReq({
      title: `Delete ${order.ref}?`,
      description: 'Only draft purchase orders can be deleted. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => deleteMutation.mutate(order.id),
    })
  }

  const openEdit = (order: PurchaseOrder) => {
    setEditId(order.id)
    setFormOpen(true)
  }
  const openCreate = () => {
    setEditId(null)
    setFormOpen(true)
  }
  const openDetail = (order: PurchaseOrder) => {
    setDetailId(order.id)
    setDetailOpen(true)
  }

  const rowActions = (o: PurchaseOrder) => (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        aria-label={`View ${o.ref}`}
        onClick={() => openDetail(o)}
      >
        <Eye className="h-4 w-4" />
      </Button>
      {o.status === 'DRAFT' && (
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Edit ${o.ref}`} onClick={() => openEdit(o)}>
          <Pencil className="h-4 w-4" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`More actions for ${o.ref}`}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {o.status === 'DRAFT' && (
            <DropdownMenuItem onClick={() => handleAction(o, 'validate')}>
              <ClipboardCheck className="h-4 w-4" /> Validate
            </DropdownMenuItem>
          )}
          {o.status === 'VALIDATED' && (
            <DropdownMenuItem onClick={() => handleAction(o, 'receive')}>
              <PackageCheck className="h-4 w-4" /> Receive goods
            </DropdownMenuItem>
          )}
          {o.status === 'DRAFT' && (
            <DropdownMenuItem onClick={() => openEdit(o)}>
              <Pencil className="h-4 w-4" /> Edit
            </DropdownMenuItem>
          )}
          {['DRAFT', 'VALIDATED'].includes(o.status) && (
            <DropdownMenuItem className="text-rose-600 focus:text-rose-700" onClick={() => handleAction(o, 'cancel')}>
              <Trash2 className="h-4 w-4" /> Cancel
            </DropdownMenuItem>
          )}
          {o.status === 'DRAFT' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-rose-600 focus:text-rose-700" onClick={() => handleDelete(o)}>
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
        title="Supplier Orders"
        description="Create, validate and receive purchase orders from your suppliers."
        icon={Truck}
        actions={
          <Button onClick={openCreate} className="min-h-[40px]">
            <Plus className="h-4 w-4" /> New purchase order
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Open orders" value={stats.open} hint="Validated, awaiting goods receipt" icon={ClipboardCheck} />
        <StatCard title="Received (30 days)" value={stats.received30d} hint="Goods received this period" icon={PackageCheck} tone="success" />
        <StatCard title="Total purchase value" value={stats.totalValue} isMoney hint="All non-cancelled orders" icon={Wallet} />
      </div>

      {/* Toolbar + table */}
      <Card className="py-0 gap-0">
        <CardContent className="p-4 sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                className="min-h-[40px] pl-9"
                placeholder="Search ref or supplier…"
                aria-label="Search purchase orders"
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
              icon={ShoppingCart}
              title="No purchase orders"
              description={orders.length === 0 ? 'Create your first supplier order to start tracking purchases.' : 'No orders match your filters.'}
              actionLabel={orders.length === 0 ? 'New purchase order' : undefined}
              onAction={orders.length === 0 ? openCreate : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[880px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Expected</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => (
                    <TableRow key={o.id} className="group">
                      <TableCell className="font-mono text-sm font-semibold text-primary">{o.ref}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(o.date)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(o.expectedDate)}</TableCell>
                      <TableCell>
                        <p className="font-medium">{o.thirdParty.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {o._count?.lines ?? 0} line{(o._count?.lines ?? 0) === 1 ? '' : 's'}
                        </p>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatMoney(o.total)}</TableCell>
                      <TableCell>
                        <DocStatusBadge status={o.status} />
                      </TableCell>
                      <TableCell>{rowActions(o)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / edit */}
      <POFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        suppliers={suppliers}
        products={products}
        editId={editId}
        editOrder={editId ? (detailQuery.data ?? null) : null}
        toast={toast}
      />

      {/* Detail */}
      <PODetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        order={detailQuery.data ?? null}
        isLoading={detailQuery.isLoading}
        onAction={handleAction}
        onEdit={(o) => {
          setDetailOpen(false)
          openEdit(o)
        }}
      />

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

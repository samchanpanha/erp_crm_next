'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Boxes, Warehouse, Plus, Pencil, Trash2, Star, Loader2, TriangleAlert, Wallet, Move3d,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { get, post, put, del } from '@/components/erp/lib/api'
import { PageHeader, EmptyState } from '@/components/erp/shared/page-header'
import { StatusBadge, type Tone } from '@/components/erp/shared/status-badge'
import { StatCard } from '@/components/erp/shared/stat-card'
import { formatDate, formatMoney, formatNumber, toDateInput } from '@/components/erp/shared/format'
import { cn } from '@/lib/utils'

interface WarehouseRow {
  id: string
  code: string
  name: string
  address: string | null
  city: string | null
  country: string | null
  isDefault: boolean
  _count: { movements: number }
}

interface ProductRow {
  id: string
  ref: string
  label: string
  type: string
  unit: string
  costPrice: number
  manageStock: boolean
  stockQty: number
  minStock: number
  status: string
}

interface MovementRow {
  id: string
  productId: string
  type: string // IN | OUT | ADJUST
  qty: number // signed
  reference: string | null
  note: string | null
  date: string
  product: { id: string; ref: string; label: string; unit: string }
  warehouse: { id: string; name: string; code: string } | null
}

type MovementType = 'IN' | 'OUT' | 'ADJUST'
type FilterKey = 'all' | string

interface MovementForm {
  productId: string
  type: MovementType
  qty: string
  warehouseId: string // 'none' for no warehouse
  reference: string
  note: string
  date: string
}

interface WarehouseForm {
  code: string
  name: string
  address: string
  city: string
  country: string
  isDefault: boolean
}

const EMPTY_MOVEMENT: MovementForm = {
  productId: '',
  type: 'IN',
  qty: '',
  warehouseId: 'none',
  reference: '',
  note: '',
  date: toDateInput(new Date()),
}

const EMPTY_WAREHOUSE: WarehouseForm = {
  code: '',
  name: '',
  address: '',
  city: '',
  country: '',
  isDefault: false,
}

const MOVE_TYPE_META: Record<MovementType, { label: string; tone: Tone; hint: string }> = {
  IN: { label: 'Stock in', tone: 'success', hint: 'Units received (recorded as positive quantity)' },
  OUT: { label: 'Stock out', tone: 'danger', hint: 'Units shipped (recorded as negative quantity)' },
  ADJUST: { label: 'Adjustment', tone: 'warning', hint: 'Signed correction, e.g. -5 or +3' },
}

export default function StockModule() {
  const { toast } = useToast()
  const qc = useQueryClient()

  // ---- filters
  const [productFilter, setProductFilter] = useState<FilterKey>('all')
  const [warehouseFilter, setWarehouseFilter] = useState<FilterKey>('all')
  const [typeFilter, setTypeFilter] = useState<FilterKey>('all')

  // ---- dialogs
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveForm, setMoveForm] = useState<MovementForm>(EMPTY_MOVEMENT)
  const [whOpen, setWhOpen] = useState(false)
  const [whEditing, setWhEditing] = useState<WarehouseRow | null>(null)
  const [whForm, setWhForm] = useState<WarehouseForm>(EMPTY_WAREHOUSE)
  const [deleteTarget, setDeleteTarget] = useState<WarehouseRow | null>(null)

  // ---- queries
  const warehousesQuery = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses'],
    queryFn: () => get<WarehouseRow[]>('/api/warehouses'),
  })
  const warehouses = useMemo(() => warehousesQuery.data ?? [], [warehousesQuery.data])

  const productsQuery = useQuery<ProductRow[]>({
    queryKey: ['products'],
    queryFn: () => get<ProductRow[]>('/api/products'),
  })
  const stockProducts = useMemo(
    () => (productsQuery.data ?? []).filter((p) => p.type === 'PRODUCT' && p.manageStock),
    [productsQuery.data],
  )

  const movementsQuery = useQuery<MovementRow[]>({
    queryKey: ['stock-movements', productFilter, warehouseFilter, typeFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (productFilter !== 'all') params.set('productId', productFilter)
      if (warehouseFilter !== 'all') params.set('warehouseId', warehouseFilter)
      if (typeFilter !== 'all') params.set('type', typeFilter)
      const qs = params.toString()
      return get<MovementRow[]>(`/api/stock${qs ? `?${qs}` : ''}`)
    },
  })
  const movements = useMemo(() => movementsQuery.data ?? [], [movementsQuery.data])

  // ---- summary (over all stock-managed products)
  const summary = useMemo(() => {
    const list = productsQuery.data ?? []
    const totalQty = list
      .filter((p) => p.type === 'PRODUCT' && p.manageStock)
      .reduce((s, p) => s + p.stockQty, 0)
    const value = list
      .filter((p) => p.type === 'PRODUCT' && p.manageStock)
      .reduce((s, p) => s + p.stockQty * p.costPrice, 0)
    const low = list.filter(
      (p) => p.type === 'PRODUCT' && p.manageStock && p.stockQty <= p.minStock,
    ).length
    return { totalQty, value, low }
  }, [productsQuery.data])

  // ---- movement dialog helpers
  const selectedProduct = stockProducts.find((p) => p.id === moveForm.productId) ?? null
  const parsedQty = Math.round(Number(moveForm.qty))
  const qtyValid = moveForm.qty !== '' && Number.isFinite(parsedQty) && parsedQty !== 0
  const signedQty =
    !qtyValid ? 0
      : moveForm.type === 'IN' ? Math.abs(parsedQty)
        : moveForm.type === 'OUT' ? -Math.abs(parsedQty)
          : parsedQty
  const insufficient = !!selectedProduct && selectedProduct.stockQty + signedQty < 0

  const saveMovement = useMutation({
    mutationFn: () =>
      post<MovementRow>('/api/stock', {
        productId: moveForm.productId,
        type: moveForm.type,
        qty: parsedQty,
        warehouseId: moveForm.warehouseId !== 'none' ? moveForm.warehouseId : null,
        reference: moveForm.reference.trim() || null,
        note: moveForm.note.trim() || null,
        date: moveForm.date ? new Date(`${moveForm.date}T12:00:00`).toISOString() : undefined,
      }),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ['stock-movements'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['warehouses'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast({
        title: 'Stock movement recorded',
        description: `${m.type} ${m.qty > 0 ? '+' : ''}${m.qty} — ${m.product.label}`,
      })
      setMoveOpen(false)
      setMoveForm(EMPTY_MOVEMENT)
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  })

  // ---- warehouse mutations
  const saveWarehouse = useMutation({
    mutationFn: () => {
      const payload = {
        code: whForm.code.trim(),
        name: whForm.name.trim(),
        address: whForm.address.trim() || null,
        city: whForm.city.trim() || null,
        country: whForm.country.trim() || null,
        isDefault: whForm.isDefault,
      }
      return whEditing
        ? put<WarehouseRow>(`/api/warehouses/${whEditing.id}`, payload)
        : post<WarehouseRow>('/api/warehouses', payload)
    },
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ['warehouses'] })
      toast({
        title: whEditing ? 'Warehouse updated' : 'Warehouse created',
        description: `${w.code} — ${w.name}`,
      })
      setWhOpen(false)
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  })

  const deleteWarehouse = useMutation({
    mutationFn: (id: string) => del<{ ok: boolean }>(`/api/warehouses/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouses'] })
      qc.invalidateQueries({ queryKey: ['stock-movements'] })
      toast({ title: 'Warehouse deleted' })
      setDeleteTarget(null)
    },
    onError: (e) => {
      toast({ title: 'Cannot delete', description: (e as Error).message, variant: 'destructive' })
      setDeleteTarget(null)
    },
  })

  const openMovement = () => {
    setMoveForm({ ...EMPTY_MOVEMENT, date: toDateInput(new Date()) })
    setMoveOpen(true)
  }

  const openWarehouseCreate = () => {
    setWhEditing(null)
    setWhForm(EMPTY_WAREHOUSE)
    setWhOpen(true)
  }

  const openWarehouseEdit = (w: WarehouseRow) => {
    setWhEditing(w)
    setWhForm({
      code: w.code,
      name: w.name,
      address: w.address ?? '',
      city: w.city ?? '',
      country: w.country ?? '',
      isDefault: w.isDefault,
    })
    setWhOpen(true)
  }

  const setMove = <K extends keyof MovementForm>(key: K, value: MovementForm[K]) =>
    setMoveForm((f) => ({ ...f, [key]: value }))
  const setWh = <K extends keyof WarehouseForm>(key: K, value: WarehouseForm[K]) =>
    setWhForm((f) => ({ ...f, [key]: value }))

  const loading = warehousesQuery.isLoading || productsQuery.isLoading

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Boxes}
        title="Stock & Warehouses"
        description="Warehouses, stock levels and movement history"
        actions={
          <>
            <Button variant="outline" onClick={openWarehouseCreate} className="min-h-11">
              <Warehouse className="mr-1.5 h-4 w-4" /> New warehouse
            </Button>
            <Button onClick={openMovement} className="min-h-11">
              <Plus className="mr-1.5 h-4 w-4" /> New movement
            </Button>
          </>
        }
      />

      {/* Warehouses */}
      <section aria-label="Warehouses">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {loading
            ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-[124px] rounded-xl" />)
            : warehouses.map((w) => (
              <Card key={w.id} className="py-0 gap-0">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Warehouse className="h-4.5 w-4.5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate font-semibold">
                          <span className="truncate">{w.name}</span>
                          {w.isDefault && (
                            <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="Default warehouse" />
                          )}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">{w.code}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => openWarehouseEdit(w)}
                        aria-label={`Edit ${w.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        onClick={() => setDeleteTarget(w)}
                        aria-label={`Delete ${w.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="mt-2 truncate text-xs text-muted-foreground">
                    {[w.address, w.city, w.country].filter(Boolean).join(', ') || 'No address'}
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                      <Move3d className="h-3 w-3" /> {formatNumber(w._count.movements)} movement{w._count.movements === 1 ? '' : 's'}
                    </Badge>
                    {w.isDefault && (
                      <span className="text-xs font-medium text-amber-600">Default</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      </section>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)
        ) : (
          <>
            <StatCard title="Total stock quantity" value={summary.totalQty} hint="Units on hand, all products" icon={Boxes} />
            <StatCard title="Stock value (cost)" value={summary.value} isMoney hint="Σ stock qty × cost price" icon={Wallet} />
            <StatCard
              title="Low stock items"
              value={summary.low}
              hint="At or below minimum"
              icon={TriangleAlert}
              tone={summary.low > 0 ? 'danger' : 'default'}
            />
          </>
        )}
      </div>

      {/* Movements */}
      <Card className="py-0 gap-0">
        <CardHeader className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Move3d className="h-4 w-4 text-primary" /> Stock movements
          </CardTitle>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Select value={productFilter} onValueChange={setProductFilter}>
              <SelectTrigger className="w-full sm:w-[200px]" aria-label="Filter by product">
                <SelectValue placeholder="All products" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All products</SelectItem>
                {stockProducts.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
              <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filter by warehouse">
                <SelectValue placeholder="All warehouses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All warehouses</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-[150px]" aria-label="Filter by type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="IN">Stock in</SelectItem>
                <SelectItem value="OUT">Stock out</SelectItem>
                <SelectItem value="ADJUST">Adjustment</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {movementsQuery.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : movementsQuery.isError ? (
            <p className="p-6 text-sm text-rose-600">Failed to load movements: {(movementsQuery.error as Error).message}</p>
          ) : movements.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Move3d}
                title="No stock movements"
                description="Record goods in and out to keep stock levels up to date."
                actionLabel="New movement"
                onAction={openMovement}
              />
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              <div className="min-w-[720px]">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Warehouse</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(m.date)}</TableCell>
                        <TableCell>
                          <p className="max-w-[220px] truncate font-medium">{m.product.label}</p>
                          <p className="font-mono text-xs text-muted-foreground">{m.product.ref}</p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {m.warehouse ? (
                            <span>
                              <span className="font-mono text-xs">{m.warehouse.code}</span>
                              <span className="ml-1.5 text-muted-foreground">{m.warehouse.name}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={m.type}
                            label={MOVE_TYPE_META[m.type as MovementType]?.label ?? m.type}
                            tone={MOVE_TYPE_META[m.type as MovementType]?.tone ?? 'muted'}
                          />
                        </TableCell>
                        <TableCell className={cn(
                          'text-right font-semibold tabular-nums',
                          m.qty > 0 ? 'text-emerald-600' : 'text-rose-600',
                        )}>
                          {m.qty > 0 ? `+${formatNumber(m.qty)}` : formatNumber(m.qty)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{m.reference ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="max-w-[220px]">
                          <span className="block truncate text-muted-foreground">{m.note ?? '—'}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* New movement dialog */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New stock movement</DialogTitle>
            <DialogDescription>Record stock in, stock out or an inventory adjustment.</DialogDescription>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label>Product *</Label>
                <Select
                  value={moveForm.productId}
                  onValueChange={(v) => setMove('productId', v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a stocked product" />
                  </SelectTrigger>
                  <SelectContent>
                    {stockProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label} ({p.ref}) — {p.stockQty} {p.unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedProduct && (
                  <p className="text-xs text-muted-foreground">
                    Current stock: <span className="font-semibold tabular-nums">{selectedProduct.stockQty} {selectedProduct.unit}</span>
                    {' · '}min {selectedProduct.minStock}
                  </p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select value={moveForm.type} onValueChange={(v) => setMove('type', v as MovementType)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IN">Stock in</SelectItem>
                      <SelectItem value="OUT">Stock out</SelectItem>
                      <SelectItem value="ADJUST">Adjustment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="m-qty">Quantity *</Label>
                  <Input
                    id="m-qty"
                    type="number"
                    step="1"
                    value={moveForm.qty}
                    onChange={(e) => setMove('qty', e.target.value)}
                    placeholder={moveForm.type === 'ADJUST' ? 'e.g. -5' : 'e.g. 10'}
                  />
                  <p className="text-xs text-muted-foreground">{MOVE_TYPE_META[moveForm.type].hint}</p>
                </div>
              </div>

              {qtyValid && insufficient && selectedProduct && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                  Insufficient stock (available: {selectedProduct.stockQty} {selectedProduct.unit})
                </p>
              )}
              {qtyValid && !insufficient && selectedProduct && (
                <p className="text-xs text-muted-foreground">
                  New stock level after this movement:{' '}
                  <span className="font-semibold tabular-nums text-emerald-600">
                    {selectedProduct.stockQty + signedQty} {selectedProduct.unit}
                  </span>
                </p>
              )}

              <div className="grid gap-2">
                <Label>Warehouse</Label>
                <Select value={moveForm.warehouseId} onValueChange={(v) => setMove('warehouseId', v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No warehouse</SelectItem>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.code} — {w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="m-ref">Reference</Label>
                  <Input
                    id="m-ref"
                    value={moveForm.reference}
                    onChange={(e) => setMove('reference', e.target.value)}
                    placeholder="PO2601-0001, SO…"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="m-date">Date</Label>
                  <Input
                    id="m-date"
                    type="date"
                    value={moveForm.date}
                    onChange={(e) => setMove('date', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="m-note">Note</Label>
                <Input
                  id="m-note"
                  value={moveForm.note}
                  onChange={(e) => setMove('note', e.target.value)}
                  placeholder="Optional note"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)} className="min-h-11">Cancel</Button>
            <Button
              onClick={() => saveMovement.mutate()}
              disabled={!moveForm.productId || !qtyValid || insufficient || saveMovement.isPending}
              className="min-h-11"
            >
              {saveMovement.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Record movement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Warehouse create/edit dialog */}
      <Dialog open={whOpen} onOpenChange={setWhOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{whEditing ? 'Edit warehouse' : 'New warehouse'}</DialogTitle>
            <DialogDescription>Warehouses hold stock movements for your products.</DialogDescription>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid gap-4 py-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="w-code">Code *</Label>
                  <Input
                    id="w-code"
                    value={whForm.code}
                    onChange={(e) => setWh('code', e.target.value)}
                    placeholder="WH-EAST"
                    className="font-mono"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="w-name">Name *</Label>
                  <Input
                    id="w-name"
                    value={whForm.name}
                    onChange={(e) => setWh('name', e.target.value)}
                    placeholder="East Coast Warehouse"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="w-address">Address</Label>
                <Input
                  id="w-address"
                  value={whForm.address}
                  onChange={(e) => setWh('address', e.target.value)}
                  placeholder="Street and number"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="w-city">City</Label>
                  <Input
                    id="w-city"
                    value={whForm.city}
                    onChange={(e) => setWh('city', e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="w-country">Country</Label>
                  <Input
                    id="w-country"
                    value={whForm.country}
                    onChange={(e) => setWh('country', e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="pr-3">
                  <Label htmlFor="w-default" className="text-sm font-medium">Default warehouse</Label>
                  <p className="text-xs text-muted-foreground">Used for initial stock when creating products.</p>
                </div>
                <Switch
                  id="w-default"
                  checked={whForm.isDefault}
                  onCheckedChange={(v) => setWh('isDefault', v)}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWhOpen(false)} className="min-h-11">Cancel</Button>
            <Button
              onClick={() => saveWarehouse.mutate()}
              disabled={!whForm.code.trim() || !whForm.name.trim() || saveWarehouse.isPending}
              className="min-h-11"
            >
              {saveWarehouse.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {whEditing ? 'Save changes' : 'Create warehouse'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Warehouse delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  “{deleteTarget.name}” will be removed. Warehouses with recorded stock movements cannot be deleted.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700 min-h-11"
              disabled={deleteWarehouse.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (deleteTarget) deleteWarehouse.mutate(deleteTarget.id)
              }}
            >
              {deleteWarehouse.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

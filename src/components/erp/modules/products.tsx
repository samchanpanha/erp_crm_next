'use client'

import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Package, Wrench, Plus, Search, Pencil, Trash2, TriangleAlert, Wallet, Loader2, Boxes, ImagePlus,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { get, post, put, del } from '@/components/erp/lib/api'
import { authHeaders } from '@/components/erp/lib/session-token'
import { PageHeader, EmptyState } from '@/components/erp/shared/page-header'
import { ImportExportButtons } from '@/components/erp/shared/import-export'
import { StatusBadge, DocStatusBadge } from '@/components/erp/shared/status-badge'
import { StatCard } from '@/components/erp/shared/stat-card'
import { formatMoney, formatNumber } from '@/components/erp/shared/format'
import { cn } from '@/lib/utils'

interface ProductRow {
  id: string
  ref: string
  label: string
  description: string | null
  type: string // PRODUCT | SERVICE
  sellPrice: number
  costPrice: number
  vatRate: number
  unit: string
  barcode: string | null
  imageUrl: string | null
  manageStock: boolean
  stockQty: number
  minStock: number
  status: string // ACTIVE | SUSPENDED
  createdAt: string
  updatedAt: string
  _count: { stockMovements: number }
}

type ProductType = 'PRODUCT' | 'SERVICE'
type ProductStatus = 'ACTIVE' | 'SUSPENDED'
type TabKey = 'all' | 'products' | 'services' | 'low'

interface ProductForm {
  label: string
  type: ProductType
  description: string
  sellPrice: string
  costPrice: string
  vatRate: string
  unit: string
  barcode: string
  manageStock: boolean
  stockQty: string
  minStock: string
  status: ProductStatus
}

const EMPTY_FORM: ProductForm = {
  label: '',
  type: 'PRODUCT',
  description: '',
  sellPrice: '',
  costPrice: '',
  vatRate: '20',
  unit: 'unit',
  barcode: '',
  manageStock: true,
  stockQty: '0',
  minStock: '0',
  status: 'ACTIVE',
}

const VAT_RATES = [0, 5, 10, 20]

/** Margin % for products with a real cost; null renders as "—" */
function marginPct(p: ProductRow): number | null {
  if (p.type !== 'PRODUCT' || p.costPrice <= 0 || p.sellPrice <= 0) return null
  return ((p.sellPrice - p.costPrice) / p.sellPrice) * 100
}

export default function ProductsModule() {
  const { toast } = useToast()
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<TabKey>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ProductRow | null>(null)
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imgPending, setImgPending] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const productsQuery = useQuery<ProductRow[]>({
    queryKey: ['products'],
    queryFn: () => get<ProductRow[]>('/api/products'),
  })
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data])

  // ---- Stats are always computed over the FULL catalog (not the filtered view)
  const stats = useMemo(() => {
    const totalProducts = products.filter((p) => p.type === 'PRODUCT').length
    const services = products.filter((p) => p.type === 'SERVICE').length
    const stockValue = products
      .filter((p) => p.manageStock && p.type === 'PRODUCT')
      .reduce((s, p) => s + p.stockQty * p.costPrice, 0)
    const lowStock = products.filter(
      (p) => p.type === 'PRODUCT' && p.manageStock && p.stockQty <= p.minStock,
    ).length
    return { totalProducts, services, stockValue, lowStock }
  }, [products])

  // ---- Client-side filtering (tabs + search)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      if (tab === 'products' && p.type !== 'PRODUCT') return false
      if (tab === 'services' && p.type !== 'SERVICE') return false
      if (tab === 'low' && !(p.type === 'PRODUCT' && p.manageStock && p.stockQty <= p.minStock)) return false
      if (q && !`${p.ref} ${p.label}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [products, tab, search])

  // ---- Mutations
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        label: form.label.trim(),
        type: form.type,
        description: form.description.trim() || null,
        sellPrice: Number(form.sellPrice) || 0,
        costPrice: Number(form.costPrice) || 0,
        vatRate: Number(form.vatRate) || 0,
        unit: form.unit.trim() || 'unit',
        barcode: form.barcode.trim() || null,
        manageStock: form.type === 'SERVICE' ? false : form.manageStock,
        minStock: form.type !== 'SERVICE' && form.manageStock
          ? Math.max(0, Math.round(Number(form.minStock) || 0))
          : 0,
        status: form.status,
      }
      // initial stock is set on CREATE only; edits go through stock movements
      if (!editing && form.type !== 'SERVICE' && form.manageStock) {
        payload.stockQty = Math.max(0, Math.round(Number(form.stockQty) || 0))
      }
      return editing
        ? put<ProductRow>(`/api/products/${editing.id}`, payload)
        : post<ProductRow>('/api/products', payload)
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['stock-movements'] })
      qc.invalidateQueries({ queryKey: ['warehouses'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast({
        title: editing ? 'Product updated' : 'Product created',
        description: `${p.ref} — ${p.label}`,
      })
      setDialogOpen(false)
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => del<{ ok: boolean }>(`/api/products/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['stock-movements'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast({ title: 'Product deleted' })
      setDeleteTarget(null)
    },
    onError: (e) => {
      toast({ title: 'Cannot delete', description: (e as Error).message, variant: 'destructive' })
      setDeleteTarget(null)
    },
  })

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setImageUrl(null)
    setDialogOpen(true)
  }

  const openEdit = (p: ProductRow) => {
    setEditing(p)
    setForm({
      label: p.label,
      type: p.type as ProductType,
      description: p.description ?? '',
      sellPrice: String(p.sellPrice),
      costPrice: String(p.costPrice),
      vatRate: String(p.vatRate),
      unit: p.unit,
      barcode: p.barcode ?? '',
      manageStock: p.manageStock,
      stockQty: String(p.stockQty),
      minStock: String(p.minStock),
      status: p.status as ProductStatus,
    })
    setImageUrl(p.imageUrl ?? null)
    setFormError(null)
    setDialogOpen(true)
  }

  // ---- Product image (single static file on the server, set after the product exists)
  const uploadImage = async (file: File) => {
    if (!editing) return
    setImgPending(true)
    try {
      const body = new FormData()
      body.append('file', file)
      // Plain fetch (no Content-Type header) so the browser sets the multipart boundary.
      const res = await fetch(`/api/products/${editing.id}/image`, {
        method: 'POST',
        headers: authHeaders(),
        body,
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; data?: ProductRow }
      if (!res.ok || !json.data) throw new Error(json.error ?? `Upload failed (${res.status})`)
      setImageUrl(json.data.imageUrl ?? null)
      qc.invalidateQueries({ queryKey: ['products'] })
      toast({ title: 'Image uploaded', description: `${json.data.ref} — ${json.data.label}` })
    } catch (e) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setImgPending(false)
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }

  const removeImage = async () => {
    if (!editing) return
    setImgPending(true)
    try {
      await del<ProductRow>(`/api/products/${editing.id}/image`)
      setImageUrl(null)
      qc.invalidateQueries({ queryKey: ['products'] })
      toast({ title: 'Image removed' })
    } catch (e) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setImgPending(false)
    }
  }

  const submit = () => {
    if (!form.label.trim()) {
      setFormError('Label is required')
      return
    }
    if (form.sellPrice === '' || Number.isNaN(Number(form.sellPrice)) || Number(form.sellPrice) < 0) {
      setFormError('Selling price must be a number ≥ 0')
      return
    }
    setFormError(null)
    saveMutation.mutate()
  }

  const set = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const isService = form.type === 'SERVICE'
  const trackStock = !isService && form.manageStock

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Package}
        title="Products & Services"
        description="Catalog, pricing and stock levels"
        actions={
          <>
            <ImportExportButtons entity="products" queryKeysToInvalidate={[['products']]} />
            <Button onClick={openCreate} className="min-h-11">
              <Plus className="mr-1.5 h-4 w-4" /> New product
            </Button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {productsQuery.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)
        ) : (
          <>
            <StatCard title="Products" value={stats.totalProducts} hint="Physical items in catalog" icon={Boxes} />
            <StatCard title="Services" value={stats.services} hint="Non-stock catalog items" icon={Wrench} />
            <StatCard title="Stock value (cost)" value={stats.stockValue} isMoney hint="Σ stock qty × cost price" icon={Wallet} />
            <StatCard
              title="Low stock"
              value={stats.lowStock}
              hint="At or below minimum"
              icon={TriangleAlert}
              tone={stats.lowStock > 0 ? 'danger' : 'default'}
            />
          </>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="products">Products</TabsTrigger>
            <TabsTrigger value="services">Services</TabsTrigger>
            <TabsTrigger value="low" className="gap-1.5">
              Low stock
              {stats.lowStock > 0 && (
                <span className="rounded-full bg-rose-100 px-1.5 text-xs font-semibold text-rose-700">
                  {stats.lowStock}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full lg:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ref or label…"
            className="pl-9"
            aria-label="Search products"
          />
        </div>
      </div>

      {/* Table */}
      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {productsQuery.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : productsQuery.isError ? (
            <p className="p-6 text-sm text-rose-600">Failed to load products: {(productsQuery.error as Error).message}</p>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Package}
                title={search || tab !== 'all' ? 'No products match your filters' : 'No products yet'}
                description={
                  search || tab !== 'all'
                    ? 'Try a different search term or tab.'
                    : 'Add your first product or service to the catalog.'
                }
                actionLabel={search || tab !== 'all' ? undefined : 'New product'}
                onAction={openCreate}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Sell price</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                    <TableHead className="text-right">VAT</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => {
                    const m = marginPct(p)
                    return (
                      <TableRow key={p.id} className="group">
                        <TableCell className="whitespace-nowrap font-mono text-xs font-medium">{p.ref}</TableCell>
                        <TableCell className="max-w-[260px]">
                          <div className="flex items-center gap-2.5">
                            {p.imageUrl && (
                              <img
                                src={p.imageUrl}
                                alt=""
                                aria-hidden="true"
                                className="h-9 w-9 shrink-0 rounded-md border object-cover"
                              />
                            )}
                            <div className="min-w-0">
                              <p className="truncate font-medium">{p.label}</p>
                              {p.description && (
                                <p className="truncate text-xs text-muted-foreground">{p.description}</p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {p.type === 'SERVICE'
                            ? <StatusBadge label="Service" tone="info" />
                            : <StatusBadge label="Product" tone="neutral" />}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(p.sellPrice)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatMoney(p.costPrice)}
                        </TableCell>
                        <TableCell className="text-right">
                          {m === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className={cn(
                              'font-medium tabular-nums',
                              m > 20 ? 'text-emerald-600' : m >= 0 ? 'text-amber-600' : 'text-rose-600',
                            )}>
                              {m.toFixed(1)}%
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(p.vatRate)}%</TableCell>
                        <TableCell className="text-right">
                          {p.type === 'PRODUCT' && p.manageStock ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="tabular-nums">{p.stockQty} {p.unit}</span>
                              {p.stockQty <= p.minStock && (
                                <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                                  Low
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell><DocStatusBadge status={p.status} /></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEdit(p)}
                              aria-label={`Edit ${p.label}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                              onClick={() => setDeleteTarget(p)}
                              aria-label={`Delete ${p.label}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
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

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit product' : 'New product or service'}</DialogTitle>
            <DialogDescription>
              {editing
                ? `Update catalog data for ${editing.ref}. Stock changes are made via stock movements.`
                : 'The reference is generated automatically (PD…).'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="p-label">Label *</Label>
                <Input
                  id="p-label"
                  value={form.label}
                  onChange={(e) => set('label', e.target.value)}
                  placeholder="e.g. Industrial Sensor Unit IS-200"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select
                    value={form.type}
                    onValueChange={(v) => set('type', v as ProductType)}
                    disabled={!!editing}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRODUCT">Product (stocked)</SelectItem>
                      <SelectItem value="SERVICE">Service</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => set('status', v as ProductStatus)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">Active</SelectItem>
                      <SelectItem value="SUSPENDED">Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="p-desc">Description</Label>
                <Textarea
                  id="p-desc"
                  rows={2}
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="Optional internal description"
                />
              </div>

              {/* Product image — one static file on the server, added after the product exists */}
              {editing ? (
                <div className="flex items-center gap-4 rounded-lg border p-3">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={`Image of ${editing.label}`}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <Package className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Product image</p>
                    <p className="text-xs text-muted-foreground">
                      PNG, JPEG, WebP or GIF — up to 5 MB. Shown in the catalog list.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        aria-label="Upload product image"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) void uploadImage(file)
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={imgPending}
                        onClick={() => imageInputRef.current?.click()}
                      >
                        {imgPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <ImagePlus className="h-4 w-4" aria-hidden="true" />
                        )}
                        {imageUrl ? 'Replace image' : 'Upload image'}
                      </Button>
                      {imageUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-destructive hover:text-destructive"
                          disabled={imgPending}
                          onClick={() => void removeImage()}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  Save the product first — you can add its image afterwards via Edit.
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="p-sell">Selling price *</Label>
                  <Input
                    id="p-sell"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.sellPrice}
                    onChange={(e) => set('sellPrice', e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="p-cost">Cost price</Label>
                  <Input
                    id="p-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.costPrice}
                    onChange={(e) => set('costPrice', e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>VAT rate</Label>
                  <Select value={form.vatRate} onValueChange={(v) => set('vatRate', v)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VAT_RATES.map((r) => (
                        <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="p-unit">Unit</Label>
                  <Input
                    id="p-unit"
                    value={form.unit}
                    onChange={(e) => set('unit', e.target.value)}
                    placeholder="unit, kg, hour…"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="p-barcode">Barcode</Label>
                <Input
                  id="p-barcode"
                  value={form.barcode}
                  onChange={(e) => set('barcode', e.target.value)}
                  placeholder="EAN / SKU"
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="pr-3">
                  <Label htmlFor="p-stock" className="text-sm font-medium">Manage stock</Label>
                  <p className="text-xs text-muted-foreground">
                    {isService
                      ? 'Services cannot track stock.'
                      : 'Track quantity on hand and receive low-stock alerts.'}
                  </p>
                </div>
                <Switch
                  id="p-stock"
                  checked={trackStock}
                  disabled={isService}
                  onCheckedChange={(v) => set('manageStock', v)}
                />
              </div>

              {trackStock && !editing && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="p-qty">Initial stock qty</Label>
                    <Input
                      id="p-qty"
                      type="number"
                      min="0"
                      step="1"
                      value={form.stockQty}
                      onChange={(e) => set('stockQty', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Recorded as an initial stock-in movement.</p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="p-min">Minimum stock</Label>
                    <Input
                      id="p-min"
                      type="number"
                      min="0"
                      step="1"
                      value={form.minStock}
                      onChange={(e) => set('minStock', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Low-stock alert threshold.</p>
                  </div>
                </div>
              )}

              {trackStock && editing && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Current stock</Label>
                    <p className="flex h-9 items-center text-sm font-medium tabular-nums">
                      {editing.stockQty} {editing.unit}
                    </p>
                    <p className="text-xs text-muted-foreground">Adjust via the Stock module.</p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="p-min-edit">Minimum stock</Label>
                    <Input
                      id="p-min-edit"
                      type="number"
                      min="0"
                      step="1"
                      value={form.minStock}
                      onChange={(e) => set('minStock', e.target.value)}
                    />
                  </div>
                </div>
              )}

              {formError && <p className="text-sm font-medium text-rose-600">{formError}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="min-h-11">Cancel</Button>
            <Button onClick={submit} disabled={saveMutation.isPending} className="min-h-11">
              {saveMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editing ? 'Save changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.ref}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  “{deleteTarget.label}” and its stock movement history will be removed. Products used on
                  proposals, orders or invoices cannot be deleted.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700 min-h-11"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
              }}
            >
              {deleteMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

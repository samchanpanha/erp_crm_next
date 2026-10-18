'use client'

import { Plus, Trash2 } from 'lucide-react'
import { computeTotals } from '@/lib/doc-math'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatMoney } from './format'

/**
 * Shared line-items editor used by proposals, sale orders and invoices.
 * Totals are computed with the shared doc-math helpers so the values shown
 * always match what the API persists.
 */

export interface ProductOption {
  id: string
  ref: string
  label: string
  sellPrice: number
  vatRate: number
  unit: string
}

export interface EditorLine {
  productId?: string
  label: string
  qty: number
  unitPrice: number
  discountPct: number
  vatRate: number
}

const FREE_LINE = '__free__'

const cellLabelCls = 'block text-[11px] font-medium text-muted-foreground sm:hidden'

function num(value: string, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function LineEditor({
  lines,
  onChange,
  products,
}: {
  lines: EditorLine[]
  onChange: (lines: EditorLine[]) => void
  products: ProductOption[]
}) {
  const update = (index: number, patch: Partial<EditorLine>) =>
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)))

  const onProductChange = (index: number, value: string) => {
    if (value === FREE_LINE) {
      update(index, { productId: undefined })
      return
    }
    const product = products.find((p) => p.id === value)
    if (!product) return
    update(index, {
      productId: product.id,
      label: product.label,
      unitPrice: product.sellPrice,
      vatRate: product.vatRate,
    })
  }

  const addLine = () =>
    onChange([...lines, { label: '', qty: 1, unitPrice: 0, discountPct: 0, vatRate: 20 }])

  const removeLine = (index: number) => onChange(lines.filter((_, i) => i !== index))

  const totals = computeTotals(lines)

  return (
    <div className="space-y-2" role="group" aria-label="Document lines">
      {/* Desktop header */}
      <div className="hidden gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-12">
        <span className="col-span-3">Product</span>
        <span className="col-span-3">Label</span>
        <span className="col-span-1 text-right">Qty</span>
        <span className="col-span-2 text-right">Unit price</span>
        <span className="col-span-1 text-right">Disc %</span>
        <span className="col-span-1 text-right">VAT %</span>
        <span className="col-span-1" />
      </div>

      {lines.length === 0 && (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          No lines yet — add a free line or pick a product.
        </p>
      )}

      {lines.map((line, i) => (
        <div
          key={i}
          className="grid grid-cols-2 items-end gap-2 rounded-lg border p-2.5 sm:grid-cols-12 sm:items-center sm:border-0 sm:p-0"
        >
          <div className="col-span-2 sm:col-span-3">
            <span className={cellLabelCls}>Product</span>
            <Select value={line.productId ?? FREE_LINE} onValueChange={(v) => onProductChange(i, v)}>
              <SelectTrigger className="w-full" aria-label={`Product for line ${i + 1}`}>
                <SelectValue placeholder="— Free line —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FREE_LINE}>— Free line —</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 sm:col-span-3">
            <span className={cellLabelCls}>Label</span>
            <Input
              value={line.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="Line description"
              aria-label={`Label for line ${i + 1}`}
            />
          </div>

          <div className="col-span-1 sm:col-span-1">
            <span className={cellLabelCls}>Qty</span>
            <Input
              type="number"
              min={0}
              step="any"
              value={String(line.qty)}
              onChange={(e) => update(i, { qty: num(e.target.value) })}
              aria-label={`Quantity for line ${i + 1}`}
            />
          </div>

          <div className="col-span-1 sm:col-span-2">
            <span className={cellLabelCls}>Unit price</span>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={String(line.unitPrice)}
              onChange={(e) => update(i, { unitPrice: num(e.target.value) })}
              aria-label={`Unit price for line ${i + 1}`}
            />
          </div>

          <div className="col-span-1 sm:col-span-1">
            <span className={cellLabelCls}>Disc %</span>
            <Input
              type="number"
              min={0}
              max={100}
              step="any"
              value={String(line.discountPct)}
              onChange={(e) => update(i, { discountPct: Math.min(100, Math.max(0, num(e.target.value))) })}
              aria-label={`Discount percent for line ${i + 1}`}
            />
          </div>

          <div className="col-span-1 sm:col-span-1">
            <span className={cellLabelCls}>VAT %</span>
            <Input
              type="number"
              min={0}
              max={100}
              step="any"
              value={String(line.vatRate)}
              onChange={(e) => update(i, { vatRate: Math.min(100, Math.max(0, num(e.target.value))) })}
              aria-label={`VAT rate for line ${i + 1}`}
            />
          </div>

          <div className="col-span-2 flex justify-end sm:col-span-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="relative h-9 w-9 text-muted-foreground before:absolute before:-inset-1.5 hover:text-destructive"
              onClick={() => removeLine(i)}
              aria-label={`Remove line ${i + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={addLine}>
          <Plus className="h-4 w-4" /> Add line
        </Button>
        <dl className="ml-auto min-w-[220px] space-y-1 text-sm">
          <div className="flex justify-between gap-6">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums">{formatMoney(totals.subtotal)}</dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt className="text-muted-foreground">Discount</dt>
            <dd className="tabular-nums text-amber-600">−{formatMoney(totals.discountTotal)}</dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt className="text-muted-foreground">VAT</dt>
            <dd className="tabular-nums">{formatMoney(totals.vatTotal)}</dd>
          </div>
          <div className="flex justify-between gap-6 border-t pt-1 font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums text-primary">{formatMoney(totals.total)}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

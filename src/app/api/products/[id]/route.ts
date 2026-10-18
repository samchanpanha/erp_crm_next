import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { clearProductImage } from '@/lib/product-image'

export const dynamic = 'force-dynamic'

// NOTE: stockQty is intentionally NOT updatable here — stock changes must go
// through POST /api/stock (movements keep the audit trail consistent).

const updateSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(200).optional(),
  type: z.enum(['PRODUCT', 'SERVICE']).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  sellPrice: z.coerce.number().min(0).optional(),
  costPrice: z.coerce.number().min(0).optional(),
  vatRate: z.coerce.number().min(0).max(100).optional(),
  unit: z.string().trim().min(1).max(50).optional(),
  barcode: z.string().trim().max(100).optional().nullable(),
  manageStock: z.boolean().optional(),
  minStock: z.coerce.number().int().min(0).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
})

// ---------------------------------------------------------------------------
// GET /api/products/[id]
// ---------------------------------------------------------------------------
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('products.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const product = await db.product.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { _count: { select: { stockMovements: true } } },
    })
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }
    return NextResponse.json({ data: product })
  } catch (err) {
    console.error('GET /api/products/[id] failed', err)
    return NextResponse.json({ error: 'Failed to load product' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PUT /api/products/[id]
// ---------------------------------------------------------------------------
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('products.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.product.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!existing) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 },
      )
    }
    const d = parsed.data

    // Services can never manage stock
    const type = d.type ?? existing.type
    const manageStock = type === 'SERVICE' ? false : d.manageStock ?? existing.manageStock

    const data: Prisma.ProductUncheckedUpdateInput = {}
    if (d.label !== undefined) data.label = d.label
    if (d.type !== undefined) data.type = d.type
    if (d.description !== undefined) data.description = d.description || null
    if (d.sellPrice !== undefined) data.sellPrice = d.sellPrice
    if (d.costPrice !== undefined) data.costPrice = d.costPrice
    if (d.vatRate !== undefined) data.vatRate = d.vatRate
    if (d.unit !== undefined) data.unit = d.unit
    if (d.barcode !== undefined) data.barcode = d.barcode || null
    if (d.status !== undefined) data.status = d.status
    data.manageStock = manageStock
    // keep denormalized stock counters coherent
    if (!manageStock) {
      data.stockQty = 0
      data.minStock = 0
    } else if (d.minStock !== undefined) {
      data.minStock = d.minStock
    }

    const product = await db.product.update({
      where: { id },
      data,
      include: { _count: { select: { stockMovements: true } } },
    })
    return NextResponse.json({ data: product })
  } catch (err) {
    console.error('PUT /api/products/[id] failed', err)
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/products/[id] — blocked when referenced by document lines
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('products.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.product.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, ref: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const [proposalLines, saleOrderLines, invoiceLines, purchaseOrderLines] = await Promise.all([
      db.proposalLine.count({ where: { productId: id } }),
      db.saleOrderLine.count({ where: { productId: id } }),
      db.invoiceLine.count({ where: { productId: id } }),
      db.purchaseOrderLine.count({ where: { productId: id } }),
    ])
    const usedBy = proposalLines + saleOrderLines + invoiceLines + purchaseOrderLines
    if (usedBy > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete ${existing.ref}: referenced by ${usedBy} document line${usedBy > 1 ? 's' : ''} (proposal, order or invoice)`,
        },
        { status: 400 },
      )
    }

    await db.product.delete({ where: { id } })
    // best-effort cleanup of the static image file (public/products/product-<id>.*)
    await clearProductImage(id)
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/products/[id] failed', err)
    return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 })
  }
}

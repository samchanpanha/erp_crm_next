import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { computeTotals } from '@/lib/doc-math'

export const dynamic = 'force-dynamic'

const dateString = z
  .string()
  .refine((s) => !Number.isNaN(new Date(s).getTime()), 'Invalid date')

const lineSchema = z.object({
  productId: z.string().trim().min(1).optional().nullable(),
  label: z.string().trim().min(1, 'Label is required'),
  description: z.string().optional().nullable(),
  qty: z.coerce.number().positive('Qty must be > 0'),
  unitPrice: z.coerce.number().nonnegative('Unit price must be >= 0'),
  discountPct: z.coerce.number().min(0).max(100).optional(),
  vatRate: z.coerce.number().min(0).max(100).optional(),
})

const editSchema = z.object({
  thirdPartyId: z.string().trim().min(1, 'Supplier is required'),
  date: dateString.optional(),
  expectedDate: dateString.optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, 'At least one line is required'),
})

const actionSchema = z.object({
  action: z.enum(['validate', 'cancel', 'receive']),
})

const fullInclude = {
  lines: { orderBy: { sort: 'asc' as const } },
  thirdParty: { select: { id: true, name: true, code: true } },
  _count: { select: { lines: true } },
} as const

/** GET /api/purchase-orders/[id] */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePerm('purchaseorders.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const po = await db.purchaseOrder.findFirst({
      where: { id, tenantId: user.tenantId },
      include: fullInclude,
    })
    if (!po) return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    return NextResponse.json({ data: po })
  } catch (err) {
    console.error('GET /api/purchase-orders/[id] failed', err)
    return NextResponse.json({ error: 'Failed to load purchase order' }, { status: 500 })
  }
}

/**
 * PUT /api/purchase-orders/[id]
 * - { action: 'validate' }  DRAFT → VALIDATED
 * - { action: 'receive' }   VALIDATED → RECEIVED + stock IN movements (transaction)
 * - { action: 'cancel' }    DRAFT/VALIDATED → CANCELLED (blocked from RECEIVED/BILLED)
 * - otherwise: full edit, DRAFT only (replaces lines + recomputes totals)
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePerm('purchaseorders.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const body: unknown = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const existing = await db.purchaseOrder.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!existing) return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })

    // ---- Action branch ------------------------------------------------------
    const parsedAction = actionSchema.safeParse(body)
    if (parsedAction.success) {
      const { action } = parsedAction.data

      if (action === 'validate') {
        if (existing.status !== 'DRAFT') {
          return NextResponse.json(
            { error: 'Only DRAFT purchase orders can be validated' },
            { status: 400 }
          )
        }
        const updated = await db.purchaseOrder.update({
          where: { id },
          data: { status: 'VALIDATED' },
          include: fullInclude,
        })
        return NextResponse.json({ data: updated })
      }

      if (action === 'cancel') {
        if (!['DRAFT', 'VALIDATED'].includes(existing.status)) {
          return NextResponse.json(
            { error: `Cannot cancel a ${existing.status} purchase order` },
            { status: 400 }
          )
        }
        const updated = await db.purchaseOrder.update({
          where: { id },
          data: { status: 'CANCELLED' },
          include: fullInclude,
        })
        return NextResponse.json({ data: updated })
      }

      // action === 'receive' — idempotent guard: only from VALIDATED
      if (existing.status !== 'VALIDATED') {
        return NextResponse.json(
          { error: 'Only VALIDATED purchase orders can be received' },
          { status: 400 }
        )
      }

      const lines = await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: id } })
      const productIds = [...new Set(lines.map((l) => l.productId).filter((v): v is string => !!v))]
      const managed = productIds.length
        ? await db.product.findMany({
            where: { id: { in: productIds }, tenantId: user.tenantId, manageStock: true },
            select: { id: true },
          })
        : []
      const managedIds = new Set(managed.map((p) => p.id))
      const warehouse =
        (await db.warehouse.findFirst({ where: { isDefault: true, tenantId: user.tenantId } })) ??
        (await db.warehouse.findFirst({ where: { tenantId: user.tenantId } }))

      const updated = await db.$transaction(async (tx) => {
        for (const line of lines) {
          if (!line.productId || !managedIds.has(line.productId)) continue
          const qty = Math.round(line.qty) // StockMovement.qty is Int in the schema
          if (qty === 0) continue
          await tx.stockMovement.create({
            data: {
              tenantId: user.tenantId,
              productId: line.productId,
              warehouseId: warehouse?.id ?? null,
              type: 'IN',
              qty,
              reference: existing.ref,
              note: 'Goods receipt',
            },
          })
          await tx.product.update({
            where: { id: line.productId },
            data: { stockQty: { increment: qty } },
          })
        }
        return tx.purchaseOrder.update({
          where: { id },
          data: { status: 'RECEIVED' },
          include: fullInclude,
        })
      })
      return NextResponse.json({ data: updated })
    }

    // ---- Full edit branch (DRAFT only) --------------------------------------
    const parsed = editSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 }
      )
    }
    if (existing.status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'Only DRAFT purchase orders can be edited' },
        { status: 400 }
      )
    }
    const { thirdPartyId, date, expectedDate, notes, lines } = parsed.data
    const thirdParty = await db.thirdParty.findFirst({
      where: { id: thirdPartyId, tenantId: user.tenantId },
    })
    if (!thirdParty) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
    }

    const docLines = lines.map((l, i) => ({
      productId: l.productId || null,
      label: l.label,
      description: l.description ?? null,
      qty: l.qty,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct ?? 0,
      vatRate: l.vatRate ?? 20,
      sort: i,
    }))
    const totals = computeTotals(docLines)

    const updated = await db.$transaction(async (tx) => {
      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } })
      return tx.purchaseOrder.update({
        where: { id },
        data: {
          thirdPartyId,
          date: date ? new Date(date) : existing.date,
          expectedDate:
            expectedDate === undefined
              ? existing.expectedDate
              : expectedDate
                ? new Date(expectedDate)
                : null,
          notes: notes === undefined ? existing.notes : notes,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          vatTotal: totals.vatTotal,
          total: totals.total,
          lines: { create: docLines },
        },
        include: fullInclude,
      })
    })
    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/purchase-orders/[id] failed', err)
    return NextResponse.json({ error: 'Failed to update purchase order' }, { status: 500 })
  }
}

/** DELETE /api/purchase-orders/[id] — DRAFT only */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePerm('purchaseorders.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.purchaseOrder.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!existing) return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    if (existing.status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'Only DRAFT purchase orders can be deleted' },
        { status: 400 }
      )
    }
    await db.purchaseOrder.delete({ where: { id } })
    return NextResponse.json({ data: { id } })
  } catch (err) {
    console.error('DELETE /api/purchase-orders/[id] failed', err)
    return NextResponse.json({ error: 'Failed to delete purchase order' }, { status: 500 })
  }
}

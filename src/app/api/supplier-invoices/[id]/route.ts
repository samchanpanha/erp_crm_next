import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { round2 } from '@/lib/doc-math'

export const dynamic = 'force-dynamic'

const dateString = z
  .string()
  .refine((s) => !Number.isNaN(new Date(s).getTime()), 'Invalid date')

const editSchema = z.object({
  thirdPartyId: z.string().trim().min(1, 'Supplier is required'),
  date: dateString.optional(),
  dueDate: dateString.optional().nullable(),
  subtotal: z.coerce.number().nonnegative('Subtotal must be >= 0'),
  vatTotal: z.coerce.number().nonnegative('VAT must be >= 0'),
  notes: z.string().optional().nullable(),
  purchaseOrderId: z.string().trim().min(1).optional().nullable(),
})

const actionSchema = z.object({
  action: z.enum(['validate', 'cancel']),
})

const fullInclude = {
  thirdParty: {
    select: {
      id: true,
      name: true,
      code: true,
      address: true,
      zip: true,
      city: true,
      country: true,
      email: true,
      phone: true,
      vatNumber: true,
    },
  },
  payments: { orderBy: { date: 'desc' as const } },
} as const

/**
 * SupplierInvoice has NO Prisma relation to PurchaseOrder (scalar purchaseOrderId only,
 * schema is frozen) — merge the PO ref manually to keep the API contract
 * `purchaseOrder: { id, ref } | null` intact.
 */
async function withPurchaseOrder<T extends { purchaseOrderId: string | null }>(invoice: T, tenantId: string) {
  if (!invoice.purchaseOrderId) return { ...invoice, purchaseOrder: null }
  const po = await db.purchaseOrder.findFirst({
    where: { id: invoice.purchaseOrderId, tenantId },
    select: { id: true, ref: true },
  })
  return { ...invoice, purchaseOrder: po }
}

/** GET /api/supplier-invoices/[id] — incl. payments (desc) + thirdParty + PO ref */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePerm('supplierinvoices.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const invoice = await db.supplierInvoice.findFirst({
      where: { id, tenantId: user.tenantId },
      include: fullInclude,
    })
    if (!invoice) return NextResponse.json({ error: 'Supplier invoice not found' }, { status: 404 })
    return NextResponse.json({ data: await withPurchaseOrder(invoice, user.tenantId) })
  } catch (err) {
    console.error('GET /api/supplier-invoices/[id] failed', err)
    return NextResponse.json({ error: 'Failed to load supplier invoice' }, { status: 500 })
  }
}

/**
 * PUT /api/supplier-invoices/[id]
 * - { action: 'validate' } DRAFT → UNPAID
 * - { action: 'cancel' }   DRAFT/UNPAID/PARTIAL → CANCELLED (blocked from PAID)
 * - otherwise: full edit, DRAFT only (totals recomputed: total = subtotal + vatTotal)
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePerm('supplierinvoices.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const body: unknown = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const existing = await db.supplierInvoice.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!existing) return NextResponse.json({ error: 'Supplier invoice not found' }, { status: 404 })

    // ---- Action branch ------------------------------------------------------
    const parsedAction = actionSchema.safeParse(body)
    if (parsedAction.success) {
      const { action } = parsedAction.data

      if (action === 'validate') {
        if (existing.status !== 'DRAFT') {
          return NextResponse.json(
            { error: 'Only DRAFT supplier invoices can be validated' },
            { status: 400 }
          )
        }
        const updated = await db.supplierInvoice.update({
          where: { id },
          data: { status: 'UNPAID' },
          include: fullInclude,
        })
        return NextResponse.json({ data: await withPurchaseOrder(updated, user.tenantId) })
      }

      // cancel
      if (existing.status === 'PAID' || existing.status === 'CANCELLED') {
        return NextResponse.json(
          { error: `Cannot cancel a ${existing.status} supplier invoice` },
          { status: 400 }
        )
      }
      const updated = await db.supplierInvoice.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: fullInclude,
      })
      return NextResponse.json({ data: await withPurchaseOrder(updated, user.tenantId) })
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
        { error: 'Only DRAFT supplier invoices can be edited' },
        { status: 400 }
      )
    }
    const { thirdPartyId, date, dueDate, subtotal, vatTotal, notes, purchaseOrderId } = parsed.data
    const thirdParty = await db.thirdParty.findFirst({
      where: { id: thirdPartyId, tenantId: user.tenantId },
    })
    if (!thirdParty) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
    if (purchaseOrderId) {
      const po = await db.purchaseOrder.findFirst({
        where: { id: purchaseOrderId, tenantId: user.tenantId },
      })
      if (!po) return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    const updated = await db.supplierInvoice.update({
      where: { id },
      data: {
        thirdPartyId,
        date: date ? new Date(date) : existing.date,
        dueDate:
          dueDate === undefined ? existing.dueDate : dueDate ? new Date(dueDate) : null,
        subtotal: round2(subtotal),
        vatTotal: round2(vatTotal),
        total: round2(subtotal + vatTotal),
        notes: notes === undefined ? existing.notes : notes,
        purchaseOrderId: purchaseOrderId === undefined ? existing.purchaseOrderId : purchaseOrderId || null,
      },
      include: fullInclude,
    })
    return NextResponse.json({ data: await withPurchaseOrder(updated, user.tenantId) })
  } catch (err) {
    console.error('PUT /api/supplier-invoices/[id] failed', err)
    return NextResponse.json({ error: 'Failed to update supplier invoice' }, { status: 500 })
  }
}

/** DELETE /api/supplier-invoices/[id] — DRAFT only */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePerm('supplierinvoices.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.supplierInvoice.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!existing) return NextResponse.json({ error: 'Supplier invoice not found' }, { status: 404 })
    if (existing.status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'Only DRAFT supplier invoices can be deleted' },
        { status: 400 }
      )
    }
    await db.supplierInvoice.delete({ where: { id } })
    return NextResponse.json({ data: { id } })
  } catch (err) {
    console.error('DELETE /api/supplier-invoices/[id] failed', err)
    return NextResponse.json({ error: 'Failed to delete supplier invoice' }, { status: 500 })
  }
}

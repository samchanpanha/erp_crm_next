import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { nextRef } from '@/lib/refs'
import { computeTotals } from '@/lib/doc-math'

export const dynamic = 'force-dynamic'

const SALE_ORDER_ACTIONS = ['validate', 'deliver', 'cancel', 'convert_to_invoice'] as const

const optionalDate = z
  .string()
  .optional()
  .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), 'Invalid date')

const lineSchema = z.object({
  productId: z.string().min(1).optional().nullable(),
  label: z.string().trim().min(1, 'Line label is required'),
  description: z.string().optional().nullable(),
  qty: z.number().positive('Quantity must be greater than 0'),
  unitPrice: z.number().min(0, 'Unit price must be >= 0'),
  discountPct: z.number().min(0).max(100).default(0),
  vatRate: z.number().min(0).max(100).default(20),
})

const actionSchema = z.object({ action: z.enum(SALE_ORDER_ACTIONS) })

const editSchema = z.object({
  thirdPartyId: z.string().min(1, 'Third party is required'),
  date: optionalDate,
  deliveryDate: optionalDate,
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, 'At least one line is required'),
})

const orderInclude = {
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
  lines: { orderBy: { sort: 'asc' } },
} as const

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** Create a doc with a fresh ref, retrying on ref collisions (seed data
 *  pre-allocates refs without hydrating the Sequence table). */
async function createWithRef<T>(tenantId: string, prefix: string, make: (ref: string) => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 12; attempt++) {
    const ref = await nextRef(tenantId, prefix)
    try {
      return await make(ref)
    } catch (e) {
      lastErr = e
      if ((e as { code?: string }).code === 'P2002') continue
      throw e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Unable to generate a unique document reference')
}

/** Server-side status transition rules for sale orders */
function applyAction(
  current: string,
  action: (typeof SALE_ORDER_ACTIONS)[number]
): { ok: true } | { ok: false; error: string } {
  switch (action) {
    case 'validate':
      if (current !== 'DRAFT') return { ok: false, error: `Cannot validate a sale order in status ${current}` }
      return { ok: true }
    case 'deliver':
      if (current !== 'VALIDATED') return { ok: false, error: `Only validated orders can be marked delivered (status is ${current})` }
      return { ok: true }
    case 'cancel':
      if (current === 'BILLED') return { ok: false, error: 'A billed order cannot be cancelled' }
      if (!['DRAFT', 'VALIDATED', 'DELIVERED'].includes(current))
        return { ok: false, error: `Cannot cancel a sale order in status ${current}` }
      return { ok: true }
    case 'convert_to_invoice':
      if (!['VALIDATED', 'DELIVERED'].includes(current))
        return { ok: false, error: `Only validated or delivered orders can be invoiced (status is ${current})` }
      return { ok: true }
  }
}

// ---------------------------------------------------------------------------
// GET /api/sale-orders/:id
// ---------------------------------------------------------------------------
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePerm('saleorders.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const saleOrder = await db.saleOrder.findFirst({
      where: { id, tenantId: user.tenantId },
      include: orderInclude,
    })
    if (!saleOrder) return bad('Sale order not found', 404)
    return NextResponse.json({ data: saleOrder })
  } catch (err) {
    console.error('GET /api/sale-orders/[id] failed', err)
    return bad('Failed to load sale order', 500)
  }
}

// ---------------------------------------------------------------------------
// PUT /api/sale-orders/:id — action mode OR full edit (DRAFT only)
// ---------------------------------------------------------------------------
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePerm('saleorders.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const saleOrder = await db.saleOrder.findFirst({
      where: { id, tenantId: user.tenantId },
      include: orderInclude,
    })
    if (!saleOrder) return bad('Sale order not found', 404)

    // ----- Action mode -----
    const actionParsed = actionSchema.safeParse(body)
    if (actionParsed.success) {
      const action = actionParsed.data.action
      const check = applyAction(saleOrder.status, action)
      if (!check.ok) return bad(check.error)

      if (action === 'convert_to_invoice') {
        const totals = computeTotals(saleOrder.lines)
        const dueDate = new Date()
        dueDate.setDate(dueDate.getDate() + 30)
        const orderId = saleOrder.id
        const tpId = saleOrder.thirdPartyId
        const notes = saleOrder.notes
        const copiedLines = saleOrder.lines.map((l, i) => ({
          productId: l.productId,
          label: l.label,
          description: l.description,
          qty: l.qty,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          vatRate: l.vatRate,
          sort: i,
        }))

        const invoice = await createWithRef(user.tenantId, 'IN', (ref) =>
          db.invoice.create({
            data: {
              ref,
              tenantId: user.tenantId,
              thirdPartyId: tpId,
              status: 'DRAFT',
              date: new Date(),
              dueDate,
              saleOrderId: orderId,
              notes,
              subtotal: totals.subtotal,
              discountTotal: totals.discountTotal,
              vatTotal: totals.vatTotal,
              total: totals.total,
              lines: { create: copiedLines },
            },
          })
        )
        const updated = await db.saleOrder.update({
          where: { id },
          data: { status: 'BILLED' },
          include: orderInclude,
        })
        return NextResponse.json({ data: { invoice, saleOrder: updated } })
      }

      const nextStatus =
        action === 'validate' ? 'VALIDATED'
        : action === 'deliver' ? 'DELIVERED'
        : 'CANCELLED'

      const updated = await db.saleOrder.update({
        where: { id },
        data: { status: nextStatus },
        include: orderInclude,
      })
      return NextResponse.json({ data: updated })
    }

    // ----- Full edit mode (DRAFT only) -----
    if (saleOrder.status !== 'DRAFT') {
      return bad('Only draft sale orders can be edited — use an action instead')
    }
    const editParsed = editSchema.safeParse(body)
    if (!editParsed.success) {
      return bad(editParsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const { thirdPartyId, date, deliveryDate, notes, lines } = editParsed.data

    const thirdParty = await db.thirdParty.findFirst({
      where: { id: thirdPartyId, tenantId: user.tenantId },
    })
    if (!thirdParty) return bad('Third party not found')

    const totals = computeTotals(lines)
    const updated = await db.saleOrder.update({
      where: { id },
      data: {
        thirdPartyId,
        date: date ? new Date(date) : saleOrder.date,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
        notes: notes ?? null,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        vatTotal: totals.vatTotal,
        total: totals.total,
        lines: {
          deleteMany: {},
          create: lines.map((l, i) => ({
            productId: l.productId ?? null,
            label: l.label,
            description: l.description ?? null,
            qty: l.qty,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            vatRate: l.vatRate,
            sort: i,
          })),
        },
      },
      include: orderInclude,
    })
    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/sale-orders/[id] failed', err)
    return bad('Failed to update sale order', 500)
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/sale-orders/:id — DRAFT only
// ---------------------------------------------------------------------------
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePerm('saleorders.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const saleOrder = await db.saleOrder.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!saleOrder) return bad('Sale order not found', 404)
    if (saleOrder.status !== 'DRAFT') return bad('Only draft sale orders can be deleted')
    await db.saleOrder.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/sale-orders/[id] failed', err)
    return bad('Failed to delete sale order', 500)
  }
}

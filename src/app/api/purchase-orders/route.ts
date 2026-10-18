import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { nextRef } from '@/lib/refs'
import { computeTotals } from '@/lib/doc-math'

export const dynamic = 'force-dynamic'

const PO_STATUSES = ['DRAFT', 'VALIDATED', 'RECEIVED', 'BILLED', 'CANCELLED'] as const

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

const createSchema = z.object({
  thirdPartyId: z.string().trim().min(1, 'Supplier is required'),
  date: dateString.optional(),
  expectedDate: dateString.optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, 'At least one line is required'),
})

const poInclude = {
  thirdParty: { select: { id: true, name: true, code: true } },
  _count: { select: { lines: true } },
} as const

/** GET /api/purchase-orders?q=&status=&thirdPartyId= */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePerm('purchaseorders.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim() ?? ''
    const status = searchParams.get('status')?.trim() ?? ''
    const thirdPartyId = searchParams.get('thirdPartyId')?.trim() ?? ''

    const where: Record<string, unknown> = { tenantId: user.tenantId }
    if (q) {
      where.OR = [
        { ref: { contains: q } },
        { thirdParty: { is: { name: { contains: q } } } },
      ]
    }
    if (status) {
      if (!(PO_STATUSES as readonly string[]).includes(status)) {
        return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 })
      }
      where.status = status
    }
    if (thirdPartyId) where.thirdPartyId = thirdPartyId

    const orders = await db.purchaseOrder.findMany({
      where,
      include: poInclude,
      orderBy: { date: 'desc' },
    })
    return NextResponse.json({ data: orders })
  } catch (err) {
    console.error('GET /api/purchase-orders failed', err)
    return NextResponse.json({ error: 'Failed to load purchase orders' }, { status: 500 })
  }
}

/** POST /api/purchase-orders — create DRAFT order with ≥1 line */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePerm('purchaseorders.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const body = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
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

    // The seed uses its own local ref counters (Sequence table is reset without
    // being re-synced), so the first generated refs can collide with seeded ones.
    // Retry on unique-violation: each attempt consumes the next sequence number.
    let created: Awaited<ReturnType<typeof db.purchaseOrder.create>> | null = null
    for (let attempt = 0; attempt < 25 && !created; attempt++) {
      try {
        created = await db.purchaseOrder.create({
          data: {
            ref: await nextRef(user.tenantId, 'PO'),
            tenantId: user.tenantId,
            thirdPartyId,
            status: 'DRAFT',
            date: date ? new Date(date) : new Date(),
            expectedDate: expectedDate ? new Date(expectedDate) : null,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            vatTotal: totals.vatTotal,
            total: totals.total,
            notes: notes ?? null,
            lines: { create: docLines },
          },
          include: { lines: { orderBy: { sort: 'asc' } }, ...poInclude },
        })
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e
      }
    }
    if (!created) {
      return NextResponse.json(
        { error: 'Could not generate a unique purchase order reference' },
        { status: 500 }
      )
    }
    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/purchase-orders failed', err)
    return NextResponse.json({ error: 'Failed to create purchase order' }, { status: 500 })
  }
}

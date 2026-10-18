import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { nextRef } from '@/lib/refs'
import { round2 } from '@/lib/doc-math'

export const dynamic = 'force-dynamic'

const SI_STATUSES = ['DRAFT', 'UNPAID', 'PARTIAL', 'PAID', 'CANCELLED'] as const

const dateString = z
  .string()
  .refine((s) => !Number.isNaN(new Date(s).getTime()), 'Invalid date')

const createSchema = z.object({
  thirdPartyId: z.string().trim().min(1, 'Supplier is required'),
  date: dateString.optional(),
  dueDate: dateString.optional().nullable(),
  subtotal: z.coerce.number().nonnegative('Subtotal must be >= 0'),
  vatTotal: z.coerce.number().nonnegative('VAT must be >= 0'),
  notes: z.string().optional().nullable(),
  purchaseOrderId: z.string().trim().min(1).optional().nullable(),
})

const siInclude = {
  thirdParty: { select: { id: true, name: true, code: true } },
} as const

/**
 * SupplierInvoice has NO Prisma relation to PurchaseOrder (scalar purchaseOrderId only,
 * schema is frozen) — so we merge PO refs manually to keep the API contract
 * `purchaseOrder: { id, ref } | null` intact.
 */
async function withPurchaseOrders<T extends { purchaseOrderId: string | null }>(invoices: T[], tenantId: string) {
  const poIds = [...new Set(invoices.map((i) => i.purchaseOrderId).filter((v): v is string => !!v))]
  const pos = poIds.length
    ? await db.purchaseOrder.findMany({
        where: { id: { in: poIds }, tenantId },
        select: { id: true, ref: true },
      })
    : []
  const poMap = new Map(pos.map((p) => [p.id, p]))
  return invoices.map((i) => ({
    ...i,
    purchaseOrder: i.purchaseOrderId ? poMap.get(i.purchaseOrderId) ?? null : null,
  }))
}

/** GET /api/supplier-invoices?q=&status= */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePerm('supplierinvoices.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim() ?? ''
    const status = searchParams.get('status')?.trim() ?? ''

    const where: Record<string, unknown> = { tenantId: user.tenantId }
    if (q) {
      where.OR = [
        { ref: { contains: q } },
        { thirdParty: { is: { name: { contains: q } } } },
      ]
    }
    if (status) {
      if (!(SI_STATUSES as readonly string[]).includes(status)) {
        return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 })
      }
      where.status = status
    }

    const invoices = await db.supplierInvoice.findMany({
      where,
      include: siInclude,
      orderBy: { date: 'desc' },
    })
    return NextResponse.json({ data: await withPurchaseOrders(invoices, user.tenantId) })
  } catch (err) {
    console.error('GET /api/supplier-invoices failed', err)
    return NextResponse.json({ error: 'Failed to load supplier invoices' }, { status: 500 })
  }
}

/** POST /api/supplier-invoices — create DRAFT invoice (totals entered directly, no lines) */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePerm('supplierinvoices.edit')
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
    const { thirdPartyId, date, dueDate, subtotal, vatTotal, notes, purchaseOrderId } = parsed.data

    const thirdParty = await db.thirdParty.findFirst({
      where: { id: thirdPartyId, tenantId: user.tenantId },
    })
    if (!thirdParty) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
    }
    if (purchaseOrderId) {
      const po = await db.purchaseOrder.findFirst({
        where: { id: purchaseOrderId, tenantId: user.tenantId },
      })
      if (!po) return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    // The seed uses its own local ref counters (Sequence table is reset without
    // being re-synced), so the first generated refs can collide with seeded ones.
    // Retry on unique-violation: each attempt consumes the next sequence number.
    let created: Awaited<ReturnType<typeof db.supplierInvoice.create>> | null = null
    for (let attempt = 0; attempt < 25 && !created; attempt++) {
      try {
        created = await db.supplierInvoice.create({
          data: {
            ref: await nextRef(user.tenantId, 'SI'),
            tenantId: user.tenantId,
            thirdPartyId,
            status: 'DRAFT',
            date: date ? new Date(date) : new Date(),
            dueDate: dueDate ? new Date(dueDate) : null,
            subtotal: round2(subtotal),
            vatTotal: round2(vatTotal),
            total: round2(subtotal + vatTotal),
            notes: notes ?? null,
            purchaseOrderId: purchaseOrderId || null,
          },
          include: siInclude,
        })
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e
      }
    }
    if (!created) {
      return NextResponse.json(
        { error: 'Could not generate a unique supplier invoice reference' },
        { status: 500 }
      )
    }
    return NextResponse.json(
      { data: (await withPurchaseOrders([created], user.tenantId))[0] },
      { status: 201 }
    )
  } catch (err) {
    console.error('POST /api/supplier-invoices failed', err)
    return NextResponse.json({ error: 'Failed to create supplier invoice' }, { status: 500 })
  }
}

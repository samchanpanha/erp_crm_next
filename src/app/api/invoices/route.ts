import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { nextRef } from '@/lib/refs'
import { computeTotals } from '@/lib/doc-math'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
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

const createSchema = z.object({
  thirdPartyId: z.string().min(1, 'Third party is required'),
  date: optionalDate,
  dueDate: optionalDate,
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, 'At least one line is required'),
})

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

// ---------------------------------------------------------------------------
// GET /api/invoices?q=&status=&thirdPartyId=
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  try {
    const ctx = await requirePerm('invoices.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const url = new URL(request.url)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const status = url.searchParams.get('status')?.trim() ?? ''
    const thirdPartyId = url.searchParams.get('thirdPartyId')?.trim() ?? ''

    const invoices = await db.invoice.findMany({
      where: {
        tenantId: user.tenantId,
        ...(status ? { status } : {}),
        ...(thirdPartyId ? { thirdPartyId } : {}),
      },
      include: {
        thirdParty: { select: { id: true, name: true, code: true } },
        _count: { select: { lines: true, payments: true } },
      },
      orderBy: { date: 'desc' },
    })

    const needle = q.toLowerCase()
    const filtered = needle
      ? invoices.filter(
          (i) =>
            i.ref.toLowerCase().includes(needle) ||
            (i.notes ?? '').toLowerCase().includes(needle) ||
            i.thirdParty.name.toLowerCase().includes(needle)
        )
      : invoices

    return NextResponse.json({ data: filtered })
  } catch (err) {
    console.error('GET /api/invoices failed', err)
    return NextResponse.json({ error: 'Failed to load invoices' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/invoices — create a DRAFT invoice with nested lines
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  try {
    const ctx = await requirePerm('invoices.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const body = await request.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 }
      )
    }
    const { thirdPartyId, date, dueDate, notes, lines } = parsed.data

    const thirdParty = await db.thirdParty.findFirst({
      where: { id: thirdPartyId, tenantId: user.tenantId },
    })
    if (!thirdParty) {
      return NextResponse.json({ error: 'Third party not found' }, { status: 400 })
    }

    const totals = computeTotals(lines)
    const invoice = await createWithRef(user.tenantId, 'IN', (ref) =>
      db.invoice.create({
        data: {
          ref,
          tenantId: user.tenantId,
          thirdPartyId,
          status: 'DRAFT',
          date: date ? new Date(date) : new Date(),
          dueDate: dueDate ? new Date(dueDate) : null,
          notes: notes ?? null,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          vatTotal: totals.vatTotal,
          total: totals.total,
          lines: {
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
        include: {
          thirdParty: { select: { id: true, name: true, code: true } },
          lines: { orderBy: { sort: 'asc' } },
        },
      })
    )

    return NextResponse.json({ data: invoice }, { status: 201 })
  } catch (err) {
    console.error('POST /api/invoices failed', err)
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 })
  }
}

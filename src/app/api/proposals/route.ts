import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
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
  validUntil: optionalDate,
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, 'At least one line is required'),
})

/**
 * Create a document with a freshly generated ref. The seed script pre-creates
 * refs (PR2610-0001…) without hydrating the Sequence table, so the first
 * nextRef() calls can collide — retry on the unique-constraint error (P2002).
 */
async function createWithRef<T>(prefix: string, make: (ref: string) => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 12; attempt++) {
    const ref = await nextRef(prefix)
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
// GET /api/proposals?q=&status=&thirdPartyId=
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const status = url.searchParams.get('status')?.trim() ?? ''
    const thirdPartyId = url.searchParams.get('thirdPartyId')?.trim() ?? ''

    const proposals = await db.proposal.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(thirdPartyId ? { thirdPartyId } : {}),
      },
      include: {
        thirdParty: { select: { id: true, name: true, code: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { date: 'desc' },
    })

    const needle = q.toLowerCase()
    const filtered = needle
      ? proposals.filter(
          (p) =>
            p.ref.toLowerCase().includes(needle) ||
            (p.notes ?? '').toLowerCase().includes(needle) ||
            p.thirdParty.name.toLowerCase().includes(needle)
        )
      : proposals

    return NextResponse.json({ data: filtered })
  } catch (err) {
    console.error('GET /api/proposals failed', err)
    return NextResponse.json({ error: 'Failed to load proposals' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/proposals — create a DRAFT proposal with nested lines
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 }
      )
    }
    const { thirdPartyId, date, validUntil, notes, lines } = parsed.data

    const thirdParty = await db.thirdParty.findUnique({ where: { id: thirdPartyId } })
    if (!thirdParty) {
      return NextResponse.json({ error: 'Third party not found' }, { status: 400 })
    }

    const totals = computeTotals(lines)
    const proposal = await createWithRef('PR', (ref) =>
      db.proposal.create({
        data: {
          ref,
          thirdPartyId,
          status: 'DRAFT',
          date: date ? new Date(date) : new Date(),
          validUntil: validUntil ? new Date(validUntil) : null,
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

    return NextResponse.json({ data: proposal }, { status: 201 })
  } catch (err) {
    console.error('POST /api/proposals failed', err)
    return NextResponse.json({ error: 'Failed to create proposal' }, { status: 500 })
  }
}

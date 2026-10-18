import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { nextRef } from '@/lib/refs'
import { computeTotals } from '@/lib/doc-math'

export const dynamic = 'force-dynamic'

const PROPOSAL_ACTIONS = ['validate', 'accept', 'refuse', 'close', 'convert_to_order'] as const

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

const actionSchema = z.object({ action: z.enum(PROPOSAL_ACTIONS) })

const editSchema = z.object({
  thirdPartyId: z.string().min(1, 'Third party is required'),
  date: optionalDate,
  validUntil: optionalDate,
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, 'At least one line is required'),
})

const proposalInclude = {
  thirdParty: { select: { id: true, name: true, code: true } },
  lines: { orderBy: { sort: 'asc' } },
} as const

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** Create a doc with a fresh ref, retrying on ref collisions (seed data
 *  pre-allocates refs without hydrating the Sequence table). */
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

/** Server-side status transition rules for proposals */
function applyAction(
  current: string,
  action: (typeof PROPOSAL_ACTIONS)[number]
): { ok: true } | { ok: false; error: string } {
  switch (action) {
    case 'validate':
      if (current !== 'DRAFT') return { ok: false, error: `Cannot validate a proposal in status ${current}` }
      return { ok: true }
    case 'accept':
      if (current !== 'VALIDATED') return { ok: false, error: `Cannot accept a proposal in status ${current}` }
      return { ok: true }
    case 'refuse':
      if (current !== 'VALIDATED') return { ok: false, error: `Cannot refuse a proposal in status ${current}` }
      return { ok: true }
    case 'close':
      if (!['DRAFT', 'VALIDATED', 'ACCEPTED', 'REFUSED'].includes(current))
        return { ok: false, error: `Cannot close a proposal in status ${current}` }
      return { ok: true }
    case 'convert_to_order':
      if (!['ACCEPTED', 'VALIDATED'].includes(current))
        return { ok: false, error: `Only accepted or validated proposals can be converted (status is ${current})` }
      return { ok: true }
  }
}

// ---------------------------------------------------------------------------
// GET /api/proposals/:id
// ---------------------------------------------------------------------------
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const proposal = await db.proposal.findUnique({
      where: { id },
      include: proposalInclude,
    })
    if (!proposal) return bad('Proposal not found', 404)
    return NextResponse.json({ data: proposal })
  } catch (err) {
    console.error('GET /api/proposals/[id] failed', err)
    return bad('Failed to load proposal', 500)
  }
}

// ---------------------------------------------------------------------------
// PUT /api/proposals/:id — action mode OR full edit (DRAFT only)
// ---------------------------------------------------------------------------
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const proposal = await db.proposal.findUnique({ where: { id }, include: proposalInclude })
    if (!proposal) return bad('Proposal not found', 404)

    // ----- Action mode -----
    const actionParsed = actionSchema.safeParse(body)
    if (actionParsed.success) {
      const action = actionParsed.data.action
      const check = applyAction(proposal.status, action)
      if (!check.ok) return bad(check.error)

      if (action === 'convert_to_order') {
        const totals = computeTotals(proposal.lines)
        const proposalId = proposal.id
        const tpId = proposal.thirdPartyId
        const notes = proposal.notes
        const copiedLines = proposal.lines.map((l, i) => ({
          productId: l.productId,
          label: l.label,
          description: l.description,
          qty: l.qty,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          vatRate: l.vatRate,
          sort: i,
        }))
        const saleOrder = await createWithRef('SO', (ref) =>
          db.saleOrder.create({
            data: {
              ref,
              thirdPartyId: tpId,
              status: 'VALIDATED',
              date: new Date(),
              notes,
              proposalId,
              subtotal: totals.subtotal,
              discountTotal: totals.discountTotal,
              vatTotal: totals.vatTotal,
              total: totals.total,
              lines: { create: copiedLines },
            },
          })
        )
        const updated = await db.proposal.update({
          where: { id },
          data: { status: 'ACCEPTED' },
          include: proposalInclude,
        })
        return NextResponse.json({ data: { proposal: updated, saleOrder } })
      }

      const nextStatus =
        action === 'validate' ? 'VALIDATED'
        : action === 'accept' ? 'ACCEPTED'
        : action === 'refuse' ? 'REFUSED'
        : 'CLOSED'

      const updated = await db.proposal.update({
        where: { id },
        data: { status: nextStatus },
        include: proposalInclude,
      })
      return NextResponse.json({ data: updated })
    }

    // ----- Full edit mode (DRAFT only) -----
    if (proposal.status !== 'DRAFT') {
      return bad('Only draft proposals can be edited — use an action instead')
    }
    const editParsed = editSchema.safeParse(body)
    if (!editParsed.success) {
      return bad(editParsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const { thirdPartyId, date, validUntil, notes, lines } = editParsed.data

    const thirdParty = await db.thirdParty.findUnique({ where: { id: thirdPartyId } })
    if (!thirdParty) return bad('Third party not found')

    const totals = computeTotals(lines)
    const updated = await db.proposal.update({
      where: { id },
      data: {
        thirdPartyId,
        date: date ? new Date(date) : proposal.date,
        validUntil: validUntil ? new Date(validUntil) : null,
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
      include: proposalInclude,
    })
    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/proposals/[id] failed', err)
    return bad('Failed to update proposal', 500)
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/proposals/:id — DRAFT only
// ---------------------------------------------------------------------------
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const proposal = await db.proposal.findUnique({ where: { id } })
    if (!proposal) return bad('Proposal not found', 404)
    if (proposal.status !== 'DRAFT') return bad('Only draft proposals can be deleted')
    await db.proposal.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/proposals/[id] failed', err)
    return bad('Failed to delete proposal', 500)
  }
}

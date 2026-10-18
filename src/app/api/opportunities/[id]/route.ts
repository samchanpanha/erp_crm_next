import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const STAGES = ['NEW', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const

const optionalDate = z.preprocess(
  (v) => {
    if (v === undefined) return undefined
    if (v === null) return null
    if (typeof v === 'string' && v.trim() === '') return null
    return v
  },
  z.coerce.date('Invalid date').nullable().optional(),
)

const optionalText = (max: number) =>
  z.preprocess(
    (v) => {
      if (v === undefined) return undefined
      if (v === null) return null
      if (typeof v === 'string') {
        const t = v.trim()
        return t.length ? t.slice(0, max) : null
      }
      return v
    },
    z.string().max(max).nullable().optional(),
  )

const updateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title is too long').optional(),
  thirdPartyId: z.string().trim().min(1, 'Third party is required').optional(),
  stage: z.enum(STAGES).optional(),
  amount: z.coerce.number('Amount must be a number').min(0, 'Amount must be 0 or more').optional(),
  probability: z.coerce
    .number('Probability must be a number')
    .int('Probability must be a whole number')
    .min(0, 'Probability must be between 0 and 100')
    .max(100, 'Probability must be between 0 and 100')
    .optional(),
  expectedCloseDate: optionalDate,
  notes: optionalText(2000),
})

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

const opportunityInclude = {
  thirdParty: { select: { id: true, name: true, code: true } },
} as const

// ---------------------------------------------------------------------------
// PUT /api/opportunities/:id → { data: Opportunity }
// ---------------------------------------------------------------------------
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('opportunities.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.opportunity.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!existing) return bad('Not found', 404)

    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))

    const sentCount = Object.values(parsed.data).filter((v) => v !== undefined).length
    if (sentCount === 0) return bad('No fields to update')

    const { thirdPartyId, ...rest } = parsed.data
    if (thirdPartyId) {
      const tp = await db.thirdParty.findFirst({
        where: { id: thirdPartyId, tenantId: user.tenantId },
        select: { id: true },
      })
      if (!tp) return bad('Third party not found')
    }

    const updated = await db.opportunity.update({
      where: { id },
      data: { ...rest, thirdPartyId },
      include: opportunityInclude,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/opportunities/[id] failed', err)
    return bad('Failed to update opportunity', 500)
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/opportunities/:id → { data: { ok: true } }
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('opportunities.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.opportunity.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!existing) return bad('Not found', 404)

    await db.opportunity.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/opportunities/[id] failed', err)
    return bad('Failed to delete opportunity', 500)
  }
}

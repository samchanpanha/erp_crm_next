import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const optionalDate = z
  .string()
  .optional()
  .nullable()
  .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), 'Invalid date')

// ---------------------------------------------------------------------------
// GET /api/contracts/:id
// ---------------------------------------------------------------------------
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePerm('contracts.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const contract = await db.contract.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { thirdParty: { select: { id: true, name: true, code: true } } },
    })
    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }
    return NextResponse.json({ data: contract })
  } catch (err) {
    console.error('GET /api/contracts/[id] failed', err)
    return NextResponse.json({ error: 'Failed to load contract' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PUT /api/contracts/:id — either { action } (lifecycle) or a partial edit.
// Actions: activate (DRAFT→ACTIVE), expire (ACTIVE→EXPIRED),
// cancel (DRAFT|ACTIVE→CANCELLED).
// ---------------------------------------------------------------------------
const actionSchema = z.object({
  action: z.enum(['activate', 'expire', 'cancel']),
})

const updateSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(200).optional(),
  billingCycle: z.enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'YEARLY']).optional(),
  amount: z.coerce.number().min(0, 'Amount must be >= 0').optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  notes: z.string().trim().max(2000).optional().nullable(),
})

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePerm('contracts.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.contract.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)

    // ----- Lifecycle actions -----
    const actionParsed = actionSchema.safeParse(body)
    if (actionParsed.success) {
      const { action } = actionParsed.data
      if (action === 'activate') {
        if (existing.status !== 'DRAFT') {
          return NextResponse.json(
            { error: `Only draft contracts can be activated (current status ${existing.status})` },
            { status: 400 }
          )
        }
        const contract = await db.contract.update({
          where: { id },
          data: { status: 'ACTIVE' },
          include: { thirdParty: { select: { id: true, name: true, code: true } } },
        })
        return NextResponse.json({ data: contract })
      }
      if (action === 'expire') {
        if (existing.status !== 'ACTIVE') {
          return NextResponse.json(
            { error: `Only active contracts can be expired (current status ${existing.status})` },
            { status: 400 }
          )
        }
        const contract = await db.contract.update({
          where: { id },
          data: { status: 'EXPIRED' },
          include: { thirdParty: { select: { id: true, name: true, code: true } } },
        })
        return NextResponse.json({ data: contract })
      }
      // cancel
      if (!['DRAFT', 'ACTIVE'].includes(existing.status)) {
        return NextResponse.json(
          { error: `Contract is already closed (status ${existing.status})` },
          { status: 400 }
        )
      }
      const contract = await db.contract.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: { thirdParty: { select: { id: true, name: true, code: true } } },
      })
      return NextResponse.json({ data: contract })
    }

    // ----- Partial edit -----
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 }
      )
    }
    const d = parsed.data
    if (Object.keys(d).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const contract = await db.contract.update({
      where: { id },
      data: {
        ...(d.label !== undefined ? { label: d.label } : {}),
        ...(d.billingCycle !== undefined ? { billingCycle: d.billingCycle } : {}),
        ...(d.amount !== undefined ? { amount: d.amount } : {}),
        ...(d.startDate !== undefined ? { startDate: d.startDate ? new Date(d.startDate) : new Date() } : {}),
        ...(d.endDate !== undefined ? { endDate: d.endDate ? new Date(d.endDate) : null } : {}),
        ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
      },
      include: { thirdParty: { select: { id: true, name: true, code: true } } },
    })

    return NextResponse.json({ data: contract })
  } catch (err) {
    console.error('PUT /api/contracts/[id] failed', err)
    return NextResponse.json({ error: 'Failed to update contract' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/contracts/:id — allowed for any status
// ---------------------------------------------------------------------------
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePerm('contracts.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.contract.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }
    await db.contract.delete({ where: { id } })
    return NextResponse.json({ data: { id } })
  } catch (err) {
    console.error('DELETE /api/contracts/[id] failed', err)
    return NextResponse.json({ error: 'Failed to delete contract' }, { status: 500 })
  }
}

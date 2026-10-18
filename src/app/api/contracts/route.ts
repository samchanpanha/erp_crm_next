import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { nextRef } from '@/lib/refs'

export const dynamic = 'force-dynamic'

const optionalDate = z
  .string()
  .optional()
  .nullable()
  .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), 'Invalid date')

// ---------------------------------------------------------------------------
// GET /api/contracts?q=&status=&thirdPartyId=
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const status = url.searchParams.get('status')?.trim() ?? ''
    const thirdPartyId = url.searchParams.get('thirdPartyId')?.trim() ?? ''

    const where: Prisma.ContractWhereInput = {}
    if (['DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED'].includes(status)) where.status = status
    if (thirdPartyId) where.thirdPartyId = thirdPartyId
    if (q) {
      where.OR = [
        { ref: { contains: q } },
        { label: { contains: q } },
        { thirdParty: { name: { contains: q } } },
      ]
    }

    const contracts = await db.contract.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { thirdParty: { select: { id: true, name: true, code: true } } },
    })

    return NextResponse.json({ data: contracts })
  } catch (err) {
    console.error('GET /api/contracts failed', err)
    return NextResponse.json({ error: 'Failed to load contracts' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/contracts — create (status DRAFT, ref CTyymm-#### generated here)
// ---------------------------------------------------------------------------
const createSchema = z.object({
  thirdPartyId: z.string().min(1, 'Third party is required'),
  label: z.string().trim().min(1, 'Label is required').max(200),
  billingCycle: z.enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'YEARLY']).default('MONTHLY'),
  amount: z.coerce.number().min(0, 'Amount must be >= 0').default(0),
  startDate: optionalDate,
  endDate: optionalDate,
  notes: z.string().trim().max(2000).optional().nullable(),
})

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 }
      )
    }
    const d = parsed.data

    const thirdParty = await db.thirdParty.findUnique({ where: { id: d.thirdPartyId } })
    if (!thirdParty) {
      return NextResponse.json({ error: 'Third party not found' }, { status: 404 })
    }

    // Retry on ref collisions: the shared Sequence counter can lag behind
    // seeded refs, so P2002 on `ref` simply means "try the next number".
    let contract: Awaited<ReturnType<typeof db.contract.findUniqueOrThrow>> | null = null
    for (let attempt = 0; attempt < 5 && !contract; attempt++) {
      try {
        const ref = await nextRef('CT')
        contract = await db.contract.create({
          data: {
            ref,
            thirdPartyId: d.thirdPartyId,
            label: d.label,
            status: 'DRAFT',
            startDate: d.startDate ? new Date(d.startDate) : new Date(),
            endDate: d.endDate ? new Date(d.endDate) : null,
            amount: d.amount,
            billingCycle: d.billingCycle,
            notes: d.notes || null,
          },
          include: { thirdParty: { select: { id: true, name: true, code: true } } },
        })
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
        throw e
      }
    }
    if (!contract) {
      return NextResponse.json({ error: 'Could not generate a unique contract ref' }, { status: 500 })
    }

    return NextResponse.json({ data: contract }, { status: 201 })
  } catch (err) {
    console.error('POST /api/contracts failed', err)
    return NextResponse.json({ error: 'Failed to create contract' }, { status: 500 })
  }
}

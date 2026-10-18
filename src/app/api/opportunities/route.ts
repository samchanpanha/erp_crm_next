import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const STAGES = ['NEW', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const
type Stage = (typeof STAGES)[number]

/** '' | null | undefined -> null */
const nullableDate = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return null
    if (typeof v === 'string' && v.trim() === '') return null
    return v
  },
  z.coerce.date('Invalid date').nullable(),
)

const optionalDate = z.preprocess(
  (v) => {
    if (v === undefined) return undefined
    if (v === null) return null
    if (typeof v === 'string' && v.trim() === '') return null
    return v
  },
  z.coerce.date('Invalid date').nullable().optional(),
)

const nullableText = (max: number) =>
  z.preprocess(
    (v) => {
      if (v === undefined || v === null) return null
      if (typeof v === 'string') {
        const t = v.trim()
        return t.length ? t.slice(0, max) : null
      }
      return v
    },
    z.string().max(max).nullable(),
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

const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title is too long'),
  thirdPartyId: z.string().trim().min(1, 'Third party is required'),
  stage: z.enum(STAGES).default('NEW'),
  amount: z.coerce.number('Amount must be a number').min(0, 'Amount must be 0 or more').default(0),
  probability: z.coerce
    .number('Probability must be a number')
    .int('Probability must be a whole number')
    .min(0, 'Probability must be between 0 and 100')
    .max(100, 'Probability must be between 0 and 100')
    .default(10),
  expectedCloseDate: nullableDate,
  notes: nullableText(2000),
})

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
// GET /api/opportunities?stage=&thirdPartyId=&q= → { data: Opportunity[] }
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const stage = searchParams.get('stage') ?? ''
    const thirdPartyId = searchParams.get('thirdPartyId')?.trim() ?? ''
    const q = searchParams.get('q')?.trim() ?? ''

    const where: {
      stage?: Stage
      thirdPartyId?: string
      OR?: (
        | { title: { contains: string } }
        | { thirdParty: { is: { name: { contains: string } } } }
      )[]
    } = {}

    if ((STAGES as readonly string[]).includes(stage)) where.stage = stage as Stage
    if (thirdPartyId) where.thirdPartyId = thirdPartyId
    if (q) {
      where.OR = [
        { title: { contains: q } },
        { thirdParty: { is: { name: { contains: q } } } },
      ]
    }

    const list = await db.opportunity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: opportunityInclude,
    })

    return NextResponse.json({ data: list })
  } catch (err) {
    console.error('GET /api/opportunities failed', err)
    return bad('Failed to load opportunities', 500)
  }
}

// ---------------------------------------------------------------------------
// POST /api/opportunities → 201 { data: Opportunity }
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))

    const tp = await db.thirdParty.findUnique({
      where: { id: parsed.data.thirdPartyId },
      select: { id: true },
    })
    if (!tp) return bad('Third party not found')

    const created = await db.opportunity.create({
      data: parsed.data,
      include: opportunityInclude,
    })

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/opportunities failed', err)
    return bad('Failed to create opportunity', 500)
  }
}

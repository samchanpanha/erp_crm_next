import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** '' | null | undefined -> null (clears nullable column); otherwise trimmed string */
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

const nullableEmail = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return null
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase()
      return t.length ? t : null
    }
    return v
  },
  z.email('Invalid email address').max(200).nullable(),
)

const thirdPartyIdField = z.preprocess(
  (v) => {
    if (typeof v === 'string') {
      const t = v.trim()
      return t.length ? t : undefined
    }
    return v
  },
  z.string().min(1).optional(),
)

const createSchema = z.object({
  thirdPartyId: thirdPartyIdField,
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  position: nullableText(100),
  email: nullableEmail,
  phone: nullableText(50),
  mobile: nullableText(50),
  isPrimary: z.boolean().default(false),
  notes: nullableText(2000),
})

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

const contactInclude = {
  thirdParty: { select: { id: true, name: true, code: true } },
} as const

// ---------------------------------------------------------------------------
// GET /api/contacts?thirdPartyId=&q= → { data: Contact[] }
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const thirdPartyId = searchParams.get('thirdPartyId')?.trim() ?? ''
    const q = searchParams.get('q')?.trim() ?? ''

    const where: {
      thirdPartyId?: string
      OR?: Record<string, { contains: string }>[]
    } = {}

    if (thirdPartyId) where.thirdPartyId = thirdPartyId
    if (q) {
      where.OR = [
        { firstName: { contains: q } },
        { lastName: { contains: q } },
        { email: { contains: q } },
        { position: { contains: q } },
        { phone: { contains: q } },
      ]
    }

    const list = await db.contact.findMany({
      where,
      orderBy: [{ isPrimary: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
      include: contactInclude,
    })

    return NextResponse.json({ data: list })
  } catch (err) {
    console.error('GET /api/contacts failed', err)
    return bad('Failed to load contacts', 500)
  }
}

// ---------------------------------------------------------------------------
// POST /api/contacts → 201 { data: Contact }
// If isPrimary, other contacts of the same third party are demoted atomically.
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))

    const { thirdPartyId, isPrimary, ...fields } = parsed.data

    if (thirdPartyId) {
      const tp = await db.thirdParty.findUnique({
        where: { id: thirdPartyId },
        select: { id: true },
      })
      if (!tp) return bad('Third party not found')
    }

    const created = await db.$transaction(async (tx) => {
      if (isPrimary && thirdPartyId) {
        await tx.contact.updateMany({
          where: { thirdPartyId, isPrimary: true },
          data: { isPrimary: false },
        })
      }
      return tx.contact.create({
        data: { ...fields, isPrimary, thirdPartyId: thirdPartyId ?? null },
        include: contactInclude,
      })
    })

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/contacts failed', err)
    return bad('Failed to create contact', 500)
  }
}

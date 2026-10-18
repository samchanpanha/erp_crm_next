import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { nextRef, REF_PREFIX } from '@/lib/refs'

export const dynamic = 'force-dynamic'

const TYPES = ['CUSTOMER', 'PROSPECT', 'SUPPLIER', 'CUSTOMER_SUPPLIER'] as const
const STATUSES = ['ACTIVE', 'SUSPENDED'] as const
const PAYMENT_TERMS = ['ON_ORDER', 'NET15', 'NET30', 'NET60'] as const

type TPType = (typeof TYPES)[number]
type TPStatus = (typeof STATUSES)[number]
type TPPaymentTerms = (typeof PAYMENT_TERMS)[number]

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

/** Same as nullableText but keeps `undefined` untouched (for partial PUT payloads) */
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

const optionalEmail = z.preprocess(
  (v) => {
    if (v === undefined) return undefined
    if (v === null) return null
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase()
      return t.length ? t : null
    }
    return v
  },
  z.email('Invalid email address').max(200).nullable().optional(),
)

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200, 'Name is too long'),
  type: z.enum(TYPES).default('CUSTOMER'),
  status: z.enum(STATUSES).default('ACTIVE'),
  email: nullableEmail,
  phone: nullableText(50),
  website: nullableText(200),
  address: nullableText(300),
  zip: nullableText(20),
  city: nullableText(100),
  country: nullableText(100),
  vatNumber: nullableText(50),
  paymentTerms: z.enum(PAYMENT_TERMS).default('NET30'),
  notes: nullableText(2000),
})

const updateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200, 'Name is too long').optional(),
  type: z.enum(TYPES).optional(),
  status: z.enum(STATUSES).optional(),
  email: optionalEmail,
  phone: optionalText(50),
  website: optionalText(200),
  address: optionalText(300),
  zip: optionalText(20),
  city: optionalText(100),
  country: optionalText(100),
  vatNumber: optionalText(50),
  paymentTerms: z.enum(PAYMENT_TERMS).optional(),
  notes: optionalText(2000),
})

/** Drop undefined keys so Prisma only updates what was sent */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

/** Prisma P2002 = unique-constraint violation (e.g. generated `code` already taken) */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

// ---------------------------------------------------------------------------
// GET /api/third-parties?q=&type=&status=  → { data: ThirdParty[] }
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const ctx = await requirePerm('thirdparties.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim() ?? ''
    const type = searchParams.get('type') ?? ''
    const status = searchParams.get('status') ?? ''

    const where: {
      tenantId?: string
      OR?: Record<string, { contains: string }>[]
      type?: TPType
      status?: TPStatus
    } = {}
    where.tenantId = user.tenantId

    if (q) {
      where.OR = [
        { name: { contains: q } },
        { code: { contains: q } },
        { email: { contains: q } },
        { city: { contains: q } },
      ]
    }
    if ((TYPES as readonly string[]).includes(type)) where.type = type as TPType
    if ((STATUSES as readonly string[]).includes(status)) where.status = status as TPStatus

    const list = await db.thirdParty.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            contacts: true,
            opportunities: true,
            proposals: true,
            saleOrders: true,
            invoices: true,
          },
        },
      },
    })

    return NextResponse.json({ data: list })
  } catch (err) {
    console.error('GET /api/third-parties failed', err)
    return bad('Failed to load third parties', 500)
  }
}

// ---------------------------------------------------------------------------
// POST /api/third-parties  → 201 { data: ThirdParty } (code generated server-side)
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  try {
    const ctx = await requirePerm('thirdparties.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))

    // nextRef(tenantId, ...) starts at 1 while the demo seed hard-coded CU codes, so the first
    // generated codes may collide — consume sequence numbers until one is free.
    for (let attempt = 0; attempt < 30; attempt++) {
      const code = await nextRef(user.tenantId, REF_PREFIX.thirdParty)
      try {
        const created = await db.thirdParty.create({
          data: { ...parsed.data, code, tenantId: user.tenantId },
          include: {
            _count: {
              select: { contacts: true, opportunities: true, proposals: true, saleOrders: true, invoices: true },
            },
          },
        })
        return NextResponse.json({ data: created }, { status: 201 })
      } catch (createErr) {
        if (!isUniqueViolation(createErr)) throw createErr
      }
    }

    return bad('Could not generate a unique code, please retry', 500)
  } catch (err) {
    console.error('POST /api/third-parties failed', err)
    return bad('Failed to create third party', 500)
  }
}

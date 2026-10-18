import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const STATUSES = ['ACTIVE', 'SUSPENDED'] as const
type EmpStatus = (typeof STATUSES)[number]

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

/** Prisma P2002 = unique-constraint violation (generated employeeCode already taken) */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

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

/** '' | null -> null; date-like string -> Date */
const nullableDate = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === '') return null
    if (typeof v === 'string') {
      const d = new Date(v)
      return Number.isNaN(d.getTime()) ? v : d
    }
    return v
  },
  z.date({ error: 'Invalid date' }).nullable(),
)

const createSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100, 'First name is too long'),
  lastName: z.string().trim().min(1, 'Last name is required').max(100, 'Last name is too long'),
  email: nullableEmail,
  phone: nullableText(50),
  position: nullableText(100),
  department: nullableText(100),
  hireDate: nullableDate,
  salary: z.coerce.number({ error: 'Salary must be a number' }).min(0, 'Salary cannot be negative').default(0),
  status: z.enum(STATUSES).default('ACTIVE'),
})

const employeeInclude = {
  _count: {
    select: {
      leaveRequests: true,
      expenseReports: true,
      timeEntries: true,
    },
  },
} as const

// ---------------------------------------------------------------------------
// GET /api/employees?q=&department=&status=  →  { data: Employee[] }
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim() ?? ''
    const department = searchParams.get('department')?.trim() ?? ''
    const status = searchParams.get('status') ?? ''

    const where: {
      OR?: Record<string, { contains: string }>[]
      department?: string
      status?: EmpStatus
    } = {}

    if (q) {
      where.OR = [
        { firstName: { contains: q } },
        { lastName: { contains: q } },
        { employeeCode: { contains: q } },
        { email: { contains: q } },
        { position: { contains: q } },
      ]
    }
    if (department) where.department = department
    if ((STATUSES as readonly string[]).includes(status)) where.status = status as EmpStatus

    const list = await db.employee.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: employeeInclude,
    })

    return NextResponse.json({ data: list })
  } catch (err) {
    console.error('GET /api/employees failed', err)
    return bad('Failed to load employees', 500)
  }
}

// ---------------------------------------------------------------------------
// POST /api/employees  →  201 { data: Employee }
// employeeCode auto-generated: EM#### (count + 1, zero-padded) with uniqueness retry.
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))

    for (let attempt = 0; attempt < 30; attempt++) {
      const count = await db.employee.count()
      const employeeCode = `EM${String(count + 1).padStart(4, '0')}`
      try {
        const created = await db.employee.create({
          data: { ...parsed.data, employeeCode },
          include: employeeInclude,
        })
        return NextResponse.json({ data: created }, { status: 201 })
      } catch (createErr) {
        if (!isUniqueViolation(createErr)) throw createErr
        // EM#### already taken (e.g. gaps after deletes) — next attempt bumps the number.
      }
    }

    return bad('Could not generate a unique employee code, please retry', 500)
  } catch (err) {
    console.error('POST /api/employees failed', err)
    return bad('Failed to create employee', 500)
  }
}

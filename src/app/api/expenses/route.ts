import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { nextRef, REF_PREFIX } from '@/lib/refs'

export const dynamic = 'force-dynamic'

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

/** Prisma P2002 = unique-constraint violation (generated ref already taken) */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

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
  employeeId: z.string().min(1, 'Employee is required'),
  date: nullableDate,
  notes: nullableText(1000),
})

const employeeMini = { select: { id: true, firstName: true, lastName: true, employeeCode: true } } as const

// ---------------------------------------------------------------------------
// GET /api/expenses?status=&employeeId=&q=  →  { data: ExpenseReport[] }
// q searches ref + employee name (client-side fallback also filters).
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim() ?? ''
    const status = searchParams.get('status') ?? ''
    const employeeId = searchParams.get('employeeId')?.trim() ?? ''

    const where: Prisma.ExpenseReportWhereInput = {}

    if (q) {
      where.OR = [
        { ref: { contains: q } },
        { employee: { firstName: { contains: q } } },
        { employee: { lastName: { contains: q } } },
        { employee: { employeeCode: { contains: q } } },
      ]
    }
    if (status) where.status = status
    if (employeeId) where.employeeId = employeeId

    const list = await db.expenseReport.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: {
        employee: employeeMini,
        _count: { select: { lines: true } },
      },
    })

    return NextResponse.json({ data: list })
  } catch (err) {
    console.error('GET /api/expenses failed', err)
    return bad('Failed to load expense reports', 500)
  }
}

// ---------------------------------------------------------------------------
// POST /api/expenses  →  201 { data: ExpenseReport }
// Always created as DRAFT; ref = nextRef('ER') with P2002 retry.
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))

    const employee = await db.employee.findUnique({
      where: { id: parsed.data.employeeId },
      select: { id: true },
    })
    if (!employee) return bad('Employee not found', 400)

    const include = { employee: employeeMini, _count: { select: { lines: true } } } as const

    for (let attempt = 0; attempt < 30; attempt++) {
      const ref = await nextRef(REF_PREFIX.expenseReport)
      try {
        const created = await db.expenseReport.create({
          data: {
            ref,
            employeeId: parsed.data.employeeId,
            status: 'DRAFT',
            date: parsed.data.date ?? new Date(),
            notes: parsed.data.notes,
            total: 0,
          },
          include,
        })
        return NextResponse.json({ data: created }, { status: 201 })
      } catch (createErr) {
        if (!isUniqueViolation(createErr)) throw createErr
        // Seed hard-coded ER refs while the Sequence counter lags — retry skips ahead.
      }
    }

    return bad('Could not generate a unique report reference, please retry', 500)
  } catch (err) {
    console.error('POST /api/expenses failed', err)
    return bad('Failed to create expense report', 500)
  }
}

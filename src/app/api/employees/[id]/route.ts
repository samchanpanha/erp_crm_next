import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const STATUSES = ['ACTIVE', 'SUSPENDED'] as const
type EmpStatus = (typeof STATUSES)[number]

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

/** Same as nullableText but keeps `undefined` untouched (partial PUT payloads) */
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

/** undefined untouched; '' | null -> null; date-like string -> Date */
const optionalDate = z.preprocess(
  (v) => {
    if (v === undefined) return undefined
    if (v === null || v === '') return null
    if (typeof v === 'string') {
      const d = new Date(v)
      return Number.isNaN(d.getTime()) ? v : d
    }
    return v
  },
  z.date({ error: 'Invalid date' }).nullable().optional(),
)

const updateSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100, 'First name is too long').optional(),
  lastName: z.string().trim().min(1, 'Last name is required').max(100, 'Last name is too long').optional(),
  email: optionalEmail,
  phone: optionalText(50),
  position: optionalText(100),
  department: optionalText(100),
  hireDate: optionalDate,
  salary: z.coerce.number({ error: 'Salary must be a number' }).min(0, 'Salary cannot be negative').optional(),
  status: z.enum(STATUSES).optional(),
})

/** Drop undefined keys so Prisma only updates what was sent */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

const detailInclude = {
  _count: {
    select: {
      leaveRequests: true,
      expenseReports: true,
      timeEntries: true,
    },
  },
} as const

// ---------------------------------------------------------------------------
// GET /api/employees/:id → { data: Employee & { _count } }
// ---------------------------------------------------------------------------
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('employees.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const employee = await db.employee.findFirst({
      where: { id, tenantId: user.tenantId },
      include: detailInclude,
    })
    if (!employee) return bad('Not found', 404)
    return NextResponse.json({ data: employee })
  } catch (err) {
    console.error('GET /api/employees/[id] failed', err)
    return bad('Failed to load employee', 500)
  }
}

// ---------------------------------------------------------------------------
// PUT /api/employees/:id → { data: Employee }  (partial update)
// ---------------------------------------------------------------------------
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('employees.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.employee.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!existing) return bad('Not found', 404)

    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))

    const data = stripUndefined(parsed.data)
    if (Object.keys(data).length === 0) return bad('No fields to update')

    const updated = await db.employee.update({
      where: { id },
      data,
      include: detailInclude,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/employees/[id] failed', err)
    return bad('Failed to update employee', 500)
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/employees/:id
// Blocked while the employee still has linked HR records (leave requests /
// expense reports) to avoid silently destroying them via schema cascade.
// TimeEntries are not blocking (schema sets employeeId → null on delete).
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('employees.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.employee.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!existing) return bad('Not found', 404)

    const [leaves, expenses] = await Promise.all([
      db.leaveRequest.count({ where: { employeeId: id } }),
      db.expenseReport.count({ where: { employeeId: id } }),
    ])

    if (leaves > 0 || expenses > 0) {
      return bad('Cannot delete: this employee has leave requests or expense reports')
    }

    await db.employee.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/employees/[id] failed', err)
    return bad('Failed to delete employee', 500)
  }
}

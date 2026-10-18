import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const TYPES = ['PAID', 'SICK', 'UNPAID', 'OTHER'] as const
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const

type LeaveType = (typeof TYPES)[number]
type LeaveStatus = (typeof STATUSES)[number]

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
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

/** '' -> invalid; date-like string -> Date */
const requiredDate = z.preprocess(
  (v) => {
    if (typeof v === 'string') {
      const d = new Date(v)
      return Number.isNaN(d.getTime()) ? v : d
    }
    return v
  },
  z.date({ error: 'Invalid date' }),
)

/** Auto days = (end - start) in days + 1, rounded to 2 decimals */
function computeDays(start: Date, end: Date): number {
  return Math.round(((end.getTime() - start.getTime()) / 86400000 + 1) * 100) / 100
}

const createSchema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  type: z.enum(TYPES).default('PAID'),
  startDate: requiredDate,
  endDate: requiredDate,
  days: z.coerce.number({ error: 'Days must be a number' }).positive('Days must be greater than 0').optional(),
  reason: nullableText(500),
})

const employeeMini = { select: { id: true, firstName: true, lastName: true, employeeCode: true } } as const

// ---------------------------------------------------------------------------
// GET /api/leave?status=&employeeId=&type=  →  { data: LeaveRequest[] }
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') ?? ''
    const employeeId = searchParams.get('employeeId')?.trim() ?? ''
    const type = searchParams.get('type') ?? ''

    const where: {
      status?: LeaveStatus
      employeeId?: string
      type?: LeaveType
    } = {}

    if ((STATUSES as readonly string[]).includes(status)) where.status = status as LeaveStatus
    if (employeeId) where.employeeId = employeeId
    if ((TYPES as readonly string[]).includes(type)) where.type = type as LeaveType

    const list = await db.leaveRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { employee: employeeMini },
    })

    return NextResponse.json({ data: list })
  } catch (err) {
    console.error('GET /api/leave failed', err)
    return bad('Failed to load leave requests', 500)
  }
}

// ---------------------------------------------------------------------------
// POST /api/leave  →  201 { data: LeaveRequest }
// endDate must be >= startDate (400 otherwise); days auto-computed when absent.
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

    if (parsed.data.endDate.getTime() < parsed.data.startDate.getTime()) {
      return bad('End date must be on or after start date')
    }

    const days = parsed.data.days ?? computeDays(parsed.data.startDate, parsed.data.endDate)

    const created = await db.leaveRequest.create({
      data: {
        employeeId: parsed.data.employeeId,
        type: parsed.data.type,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        days,
        reason: parsed.data.reason,
      },
      include: { employee: employeeMini },
    })

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/leave failed', err)
    return bad('Failed to create leave request', 500)
  }
}

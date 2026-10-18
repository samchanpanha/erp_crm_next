import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const r2 = (n: number) => Math.round(n * 100) / 100

/** Accepts '' (→ null / default now), 'yyyy-mm-dd' or a full ISO datetime string. */
const nullableDate = z
  .string()
  .trim()
  .refine((v) => v === '' || !Number.isNaN(new Date(v).getTime()), { message: 'Invalid date' })
  .optional()
  .nullable()

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

const employeeSelect = { select: { id: true, firstName: true, lastName: true } } as const

// ---------------------------------------------------------------------------
// GET /api/tasks/[id]/time — time entries for a task, most recent first.
// ---------------------------------------------------------------------------
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('projects.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const task = await db.task.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const entries = await db.timeEntry.findMany({
      where: { taskId: id },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { employee: employeeSelect },
    })

    return NextResponse.json({ data: entries })
  } catch (err) {
    console.error('GET /api/tasks/[id]/time failed', err)
    return NextResponse.json({ error: 'Failed to load time entries' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/tasks/[id]/time — log time on a task.
// { employeeId? (optional), date? (default now), hours (required > 0), note? }
// ---------------------------------------------------------------------------
const createSchema = z.object({
  employeeId: z.string().trim().optional().nullable(), // '' | null → unassigned
  date: nullableDate,
  hours: z.coerce
    .number({ message: 'Hours is required' })
    .positive('Hours must be greater than 0')
    .max(24, 'Hours cannot exceed 24 per entry'),
  note: z.string().trim().max(500).optional().nullable(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('projects.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const task = await db.task.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, ref: true },
    })
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 },
      )
    }
    const d = parsed.data

    if (d.employeeId) {
      const employee = await db.employee.findFirst({
        where: { id: d.employeeId, tenantId: user.tenantId },
        select: { id: true },
      })
      if (!employee) {
        return NextResponse.json({ error: 'Employee not found' }, { status: 400 })
      }
    }

    const date = toDate(d.date) ?? new Date()
    const entry = await db.timeEntry.create({
      data: {
        taskId: id,
        employeeId: d.employeeId || null,
        date,
        hours: r2(d.hours),
        note: d.note || null,
      },
      include: { employee: employeeSelect },
    })

    return NextResponse.json({ data: entry }, { status: 201 })
  } catch (err) {
    console.error('POST /api/tasks/[id]/time failed', err)
    return NextResponse.json({ error: 'Failed to log time' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const r2 = (n: number) => Math.round(n * 100) / 100
const clampProgress = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

/** Accepts '' (→ null / clear), 'yyyy-mm-dd' or a full ISO datetime string. */
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

const projectSelect = { select: { id: true, ref: true, title: true } } as const

// ---------------------------------------------------------------------------
// GET /api/tasks/[id] — task + project{id,ref,title} + loggedHours/entriesCount.
// ---------------------------------------------------------------------------
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('projects.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const task = await db.task.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { project: projectSelect },
    })
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const agg = await db.timeEntry.aggregate({
      where: { taskId: id },
      _sum: { hours: true },
      _count: { _all: true },
    })

    return NextResponse.json({
      data: {
        ...task,
        loggedHours: r2(agg._sum.hours ?? 0),
        entriesCount: agg._count._all,
      },
    })
  } catch (err) {
    console.error('GET /api/tasks/[id] failed', err)
    return NextResponse.json({ error: 'Failed to load task' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PUT /api/tasks/[id] — partial update ('' clears nullable fields).
// progress is clamped to 0..100; setting status DONE forces progress to 100.
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  progress: z.coerce.number().optional(), // clamped to 0..100
  plannedHours: z.coerce.number().min(0, 'Planned hours cannot be negative').optional(),
  startDate: nullableDate,
  endDate: nullableDate,
})

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('projects.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.task.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, status: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 },
      )
    }
    const d = parsed.data

    const status = d.status ?? existing.status
    const progress =
      status === 'DONE'
        ? 100
        : d.progress !== undefined
          ? clampProgress(d.progress)
          : undefined

    const data: Prisma.TaskUncheckedUpdateInput = {}
    if (d.label !== undefined) data.label = d.label
    if (d.description !== undefined) data.description = d.description || null
    if (d.status !== undefined) data.status = d.status
    if (d.priority !== undefined) data.priority = d.priority
    if (progress !== undefined) data.progress = progress
    if (d.plannedHours !== undefined) data.plannedHours = d.plannedHours
    if (d.startDate !== undefined) data.startDate = toDate(d.startDate)
    if (d.endDate !== undefined) data.endDate = toDate(d.endDate)

    const task = await db.task.update({
      where: { id },
      data,
      include: { project: projectSelect },
    })

    const agg = await db.timeEntry.aggregate({
      where: { taskId: id },
      _sum: { hours: true },
      _count: { _all: true },
    })

    return NextResponse.json({
      data: { ...task, loggedHours: r2(agg._sum.hours ?? 0), entriesCount: agg._count._all },
    })
  } catch (err) {
    console.error('PUT /api/tasks/[id] failed', err)
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/tasks/[id] — cascades to its time entries (schema onDelete).
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('projects.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.task.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, ref: true, _count: { select: { timeEntries: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    await db.task.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true, deletedEntries: existing._count.timeEntries } })
  } catch (err) {
    console.error('DELETE /api/tasks/[id] failed', err)
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 })
  }
}

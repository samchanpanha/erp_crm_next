import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const r2 = (n: number) => Math.round(n * 100) / 100

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

const thirdPartySelect = { select: { id: true, name: true, code: true } } as const

// ---------------------------------------------------------------------------
// GET /api/projects/[id]
// Shape: project + thirdParty{id,name,code} + tasks sorted createdAt asc,
// each task enriched with loggedHours (Σ timeEntries.hours) and entriesCount,
// merged from a single timeEntry.groupBy — no full entry payloads here
// (entries are fetched per task via GET /api/tasks/[id]/time).
// ---------------------------------------------------------------------------
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('projects.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const project = await db.project.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { thirdParty: thirdPartySelect, tasks: { orderBy: { createdAt: 'asc' } } },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const taskIds = project.tasks.map((t) => t.id)
    const grouped =
      taskIds.length > 0
        ? await db.timeEntry.groupBy({
            by: ['taskId'],
            where: { taskId: { in: taskIds } },
            _sum: { hours: true },
            _count: { _all: true },
          })
        : []
    const byTask = new Map(grouped.map((g) => [g.taskId, g]))

    const data = {
      ...project,
      tasks: project.tasks.map((t) => ({
        ...t,
        loggedHours: r2(byTask.get(t.id)?._sum.hours ?? 0),
        entriesCount: byTask.get(t.id)?._count._all ?? 0,
      })),
    }

    return NextResponse.json({ data })
  } catch (err) {
    console.error('GET /api/projects/[id] failed', err)
    return NextResponse.json({ error: 'Failed to load project' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PUT /api/projects/[id] — partial update ('' clears nullable fields).
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  thirdPartyId: z.string().trim().optional().nullable(), // '' | null → internal project
  status: z.enum(['OPEN', 'SUSPENDED', 'CLOSED']).optional(),
  startDate: nullableDate,
  endDate: nullableDate,
  budget: z.coerce.number().min(0, 'Budget cannot be negative').optional(),
})

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('projects.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.project.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
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

    if (d.thirdPartyId) {
      const tp = await db.thirdParty.findFirst({
        where: { id: d.thirdPartyId, tenantId: user.tenantId },
        select: { id: true },
      })
      if (!tp) {
        return NextResponse.json({ error: 'Third party not found' }, { status: 400 })
      }
    }

    const data: Prisma.ProjectUncheckedUpdateInput = {}
    if (d.title !== undefined) data.title = d.title
    if (d.description !== undefined) data.description = d.description || null
    if (d.thirdPartyId !== undefined) data.thirdPartyId = d.thirdPartyId || null
    if (d.status !== undefined) data.status = d.status
    if (d.startDate !== undefined) data.startDate = toDate(d.startDate)
    if (d.endDate !== undefined) data.endDate = toDate(d.endDate)
    if (d.budget !== undefined) data.budget = d.budget

    const project = await db.project.update({
      where: { id },
      data,
      include: { thirdParty: thirdPartySelect },
    })
    return NextResponse.json({ data: project })
  } catch (err) {
    console.error('PUT /api/projects/[id] failed', err)
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/projects/[id] — cascades to tasks and their time entries
// (onDelete: Cascade in the schema).
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('projects.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.project.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, ref: true, _count: { select: { tasks: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    await db.project.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true, deletedTasks: existing._count.tasks } })
  } catch (err) {
    console.error('DELETE /api/projects/[id] failed', err)
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
  }
}

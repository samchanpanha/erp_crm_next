import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { nextRef } from '@/lib/refs'

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

/** Σ logged hours + entry count per task, merged from one groupBy query. */
async function loggedByTask(taskIds: string[]): Promise<Map<string, { hours: number; count: number }>> {
  const map = new Map<string, { hours: number; count: number }>()
  if (taskIds.length === 0) return map
  const grouped = await db.timeEntry.groupBy({
    by: ['taskId'],
    where: { taskId: { in: taskIds } },
    _sum: { hours: true },
    _count: { _all: true },
  })
  for (const g of grouped) {
    map.set(g.taskId, { hours: r2(g._sum.hours ?? 0), count: g._count._all })
  }
  return map
}

// ---------------------------------------------------------------------------
// GET /api/tasks?projectId=&status=&priority=&q=
// Shape: task + project{id,ref,title} + loggedHours + entriesCount.
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const ctx = await requirePerm('projects.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim()
    const projectId = url.searchParams.get('projectId')
    const status = url.searchParams.get('status')
    const priority = url.searchParams.get('priority')

    const where: Prisma.TaskWhereInput = { tenantId: user.tenantId }
    if (projectId) where.projectId = projectId
    if (status && ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'].includes(status)) where.status = status
    if (priority && ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(priority)) where.priority = priority
    if (q) {
      where.OR = [{ ref: { contains: q } }, { label: { contains: q } }, { description: { contains: q } }]
    }

    const tasks = await db.task.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { id: true, ref: true, title: true } } },
    })

    const hours = await loggedByTask(tasks.map((t) => t.id))
    const data = tasks.map((t) => ({
      ...t,
      loggedHours: hours.get(t.id)?.hours ?? 0,
      entriesCount: hours.get(t.id)?.count ?? 0,
    }))

    return NextResponse.json({ data })
  } catch (err) {
    console.error('GET /api/tasks failed', err)
    return NextResponse.json({ error: 'Failed to load tasks' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/tasks — create. Ref generated server-side (TSyymm-####).
// Setting status DONE forces progress to 100 server-side.
// ---------------------------------------------------------------------------
const createSchema = z.object({
  projectId: z.string().trim().min(1, 'Project is required'),
  label: z.string().trim().min(1, 'Label is required').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']).default('TODO'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  progress: z.coerce.number().optional(), // clamped to 0..100
  plannedHours: z.coerce.number().min(0, 'Planned hours cannot be negative').default(0),
  startDate: nullableDate,
  endDate: nullableDate,
})

export async function POST(req: Request) {
  try {
    const ctx = await requirePerm('projects.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const body = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 },
      )
    }
    const d = parsed.data

    const project = await db.project.findFirst({
      where: { id: d.projectId, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 400 })
    }

    const progress = d.status === 'DONE' ? 100 : clampProgress(d.progress ?? 0)

    // Retry on ref collisions (shared Sequence counter can lag behind seeded refs).
    let task: Awaited<ReturnType<typeof createTask>> | null = null
    for (let attempt = 0; attempt < 5 && !task; attempt++) {
      try {
        const ref = await nextRef(user.tenantId, 'TS')
        task = await createTask(ref, d, progress, user.tenantId)
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
        throw e
      }
    }
    if (!task) {
      return NextResponse.json({ error: 'Could not generate a unique task ref' }, { status: 500 })
    }

    return NextResponse.json({ data: { ...task, loggedHours: 0, entriesCount: 0 } }, { status: 201 })
  } catch (err) {
    console.error('POST /api/tasks failed', err)
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }
}

async function createTask(
  ref: string,
  d: z.infer<typeof createSchema>,
  progress: number,
  tenantId: string,
): Promise<
  Prisma.TaskGetPayload<{ include: { project: { select: { id: true; ref: true; title: true } } } }>
> {
  return db.task.create({
    data: {
      tenantId,
      projectId: d.projectId,
      ref,
      label: d.label,
      description: d.description || null,
      status: d.status,
      priority: d.priority,
      progress,
      plannedHours: d.plannedHours,
      startDate: toDate(d.startDate),
      endDate: toDate(d.endDate),
    },
    include: { project: { select: { id: true, ref: true, title: true } } },
  })
}

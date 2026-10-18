import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { nextRef } from '@/lib/refs'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
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

/**
 * Σ logged hours per project, computed with two cheap aggregate queries
 * (task id → projectId map + timeEntry groupBy) instead of loading entries.
 */
async function loggedHoursByProject(projectIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (projectIds.length === 0) return map
  const tasks = await db.task.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true, projectId: true },
  })
  if (tasks.length === 0) return map
  const grouped = await db.timeEntry.groupBy({
    by: ['taskId'],
    where: { taskId: { in: tasks.map((t) => t.id) } },
    _sum: { hours: true },
  })
  const hoursByTask = new Map<string, number>(
    grouped.map((g) => [g.taskId, g._sum.hours ?? 0]),
  )
  for (const t of tasks) {
    map.set(t.projectId, (map.get(t.projectId) ?? 0) + (hoursByTask.get(t.id) ?? 0))
  }
  return map
}

/** Lightweight task summaries embedded in list rows (progress + done columns). */
const taskSummaryInclude = { tasks: { select: { status: true, progress: true } } } satisfies Prisma.ProjectInclude

// ---------------------------------------------------------------------------
// GET /api/projects?q=&status=&thirdPartyId=
// Shape: project + thirdParty{id,name,code} + task summaries (status/progress)
//        + _count.tasks + loggedHours (Σ timeEntries.hours) — everything the
//        module needs for stats & table columns in a single request.
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const ctx = await requirePerm('projects.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim()
    const status = url.searchParams.get('status')
    const thirdPartyId = url.searchParams.get('thirdPartyId')

    const where: Prisma.ProjectWhereInput = { tenantId: user.tenantId }
    if (q) {
      where.OR = [
        { ref: { contains: q } },
        { title: { contains: q } },
        { description: { contains: q } },
        { thirdParty: { name: { contains: q } } },
      ]
    }
    if (status === 'OPEN' || status === 'SUSPENDED' || status === 'CLOSED') {
      where.status = status
    }
    if (thirdPartyId) where.thirdPartyId = thirdPartyId

    const projects = await db.project.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        thirdParty: { select: { id: true, name: true, code: true } },
        ...taskSummaryInclude,
        _count: { select: { tasks: true } },
      },
    })

    const hours = await loggedHoursByProject(projects.map((p) => p.id))
    const data = projects.map((p) => ({ ...p, loggedHours: r2(hours.get(p.id) ?? 0) }))

    return NextResponse.json({ data })
  } catch (err) {
    console.error('GET /api/projects failed', err)
    return NextResponse.json({ error: 'Failed to load projects' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/projects — create. Ref generated server-side (PJyymm-####).
// ---------------------------------------------------------------------------
const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  thirdPartyId: z.string().trim().optional().nullable(), // '' | null → internal project
  status: z.enum(['OPEN', 'SUSPENDED', 'CLOSED']).default('OPEN'),
  startDate: nullableDate,
  endDate: nullableDate,
  budget: z.coerce.number().min(0, 'Budget cannot be negative').default(0),
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

    if (d.thirdPartyId) {
      const tp = await db.thirdParty.findFirst({
        where: { id: d.thirdPartyId, tenantId: user.tenantId },
        select: { id: true },
      })
      if (!tp) {
        return NextResponse.json({ error: 'Third party not found' }, { status: 400 })
      }
    }

    // Retry on ref collisions: the shared Sequence counter can lag behind
    // seeded refs, so P2002 on `ref` simply means "try the next number".
    let project: Awaited<ReturnType<typeof createProject>> | null = null
    for (let attempt = 0; attempt < 5 && !project; attempt++) {
      try {
        const ref = await nextRef(user.tenantId, 'PJ')
        project = await createProject(ref, d, user.tenantId)
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
        throw e
      }
    }
    if (!project) {
      return NextResponse.json({ error: 'Could not generate a unique project ref' }, { status: 500 })
    }

    return NextResponse.json({ data: { ...project, loggedHours: 0 } }, { status: 201 })
  } catch (err) {
    console.error('POST /api/projects failed', err)
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
  }
}

async function createProject(
  ref: string,
  d: z.infer<typeof createSchema>,
  tenantId: string,
): Promise<
  Prisma.ProjectGetPayload<{
    include: {
      thirdParty: { select: { id: true; name: true; code: true } }
      tasks: { select: { status: true; progress: true } }
      _count: { select: { tasks: true } }
    }
  }>
> {
  return db.project.create({
    data: {
      tenantId,
      ref,
      title: d.title,
      description: d.description || null,
      thirdPartyId: d.thirdPartyId || null,
      status: d.status,
      startDate: toDate(d.startDate),
      endDate: toDate(d.endDate),
      budget: d.budget,
    },
    include: {
      thirdParty: { select: { id: true, name: true, code: true } },
      ...taskSummaryInclude,
      _count: { select: { tasks: true } },
    },
  })
}

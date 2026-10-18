import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const EVENT_TYPES = ['MEETING', 'CALL', 'TASK', 'REMINDER', 'OTHER'] as const

const optionalDate = z
  .string()
  .optional()
  .nullable()
  .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), 'Invalid date')

// ---------------------------------------------------------------------------
// GET /api/agenda/:id
// ---------------------------------------------------------------------------
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePerm('agenda.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const event = await db.agendaEvent.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { thirdParty: { select: { id: true, name: true, code: true } } },
    })
    if (!event) {
      return NextResponse.json({ error: 'Agenda event not found' }, { status: 404 })
    }
    return NextResponse.json({ data: event })
  } catch (err) {
    console.error('GET /api/agenda/[id] failed', err)
    return NextResponse.json({ error: 'Failed to load agenda event' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PUT /api/agenda/:id — partial update ('' clears nullable fields)
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  type: z.enum(EVENT_TYPES).optional(),
  start: optionalDate,
  end: optionalDate,
  allDay: z.boolean().optional(),
  location: z.string().trim().max(200).optional().nullable(),
  thirdPartyId: z.string().trim().optional().nullable(),
  projectId: z.string().trim().optional().nullable(),
  owner: z.string().trim().max(120).optional().nullable(),
})

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePerm('agenda.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.agendaEvent.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!existing) {
      return NextResponse.json({ error: 'Agenda event not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 }
      )
    }
    const d = parsed.data

    if (d.thirdPartyId) {
      const tp = await db.thirdParty.findFirst({
        where: { id: d.thirdPartyId, tenantId: user.tenantId },
        select: { id: true },
      })
      if (!tp) {
        return NextResponse.json({ error: 'Third party not found' }, { status: 404 })
      }
    }

    const event = await db.agendaEvent.update({
      where: { id },
      data: {
        ...(d.title !== undefined ? { title: d.title } : {}),
        ...(d.description !== undefined ? { description: d.description || null } : {}),
        ...(d.type !== undefined ? { type: d.type } : {}),
        ...(d.start !== undefined ? { start: d.start ? new Date(d.start) : existing.start } : {}),
        ...(d.end !== undefined ? { end: d.end ? new Date(d.end) : null } : {}),
        ...(d.allDay !== undefined ? { allDay: d.allDay } : {}),
        ...(d.location !== undefined ? { location: d.location || null } : {}),
        ...(d.thirdPartyId !== undefined ? { thirdPartyId: d.thirdPartyId || null } : {}),
        ...(d.projectId !== undefined ? { projectId: d.projectId || null } : {}),
        ...(d.owner !== undefined ? { owner: d.owner || null } : {}),
      },
      include: { thirdParty: { select: { id: true, name: true, code: true } } },
    })

    return NextResponse.json({ data: event })
  } catch (err) {
    console.error('PUT /api/agenda/[id] failed', err)
    return NextResponse.json({ error: 'Failed to update agenda event' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/agenda/:id
// ---------------------------------------------------------------------------
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePerm('agenda.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.agendaEvent.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!existing) {
      return NextResponse.json({ error: 'Agenda event not found' }, { status: 404 })
    }
    await db.agendaEvent.delete({ where: { id } })
    return NextResponse.json({ data: { id } })
  } catch (err) {
    console.error('DELETE /api/agenda/[id] failed', err)
    return NextResponse.json({ error: 'Failed to delete agenda event' }, { status: 500 })
  }
}

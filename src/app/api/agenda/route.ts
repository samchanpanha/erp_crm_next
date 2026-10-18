import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const EVENT_TYPES = ['MEETING', 'CALL', 'TASK', 'REMINDER', 'OTHER'] as const

// ---------------------------------------------------------------------------
// GET /api/agenda?from=&to=&type= — default: all events sorted start asc
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const from = url.searchParams.get('from')?.trim() ?? ''
    const to = url.searchParams.get('to')?.trim() ?? ''
    const type = url.searchParams.get('type')?.trim() ?? ''

    const startFilter: { gte?: Date; lte?: Date } = {}
    if (from && !Number.isNaN(new Date(from).getTime())) startFilter.gte = new Date(from)
    if (to && !Number.isNaN(new Date(to).getTime())) startFilter.lte = new Date(to)

    const events = await db.agendaEvent.findMany({
      where: {
        ...(Object.keys(startFilter).length ? { start: startFilter } : {}),
        ...(type && (EVENT_TYPES as readonly string[]).includes(type) ? { type } : {}),
      },
      orderBy: { start: 'asc' },
      include: { thirdParty: { select: { id: true, name: true, code: true } } },
    })

    return NextResponse.json({ data: events })
  } catch (err) {
    console.error('GET /api/agenda failed', err)
    return NextResponse.json({ error: 'Failed to load agenda events' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/agenda — create an event
// ---------------------------------------------------------------------------
const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  type: z.enum(EVENT_TYPES).default('MEETING'),
  start: z
    .string()
    .min(1, 'Start date/time is required')
    .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid start date'),
  end: z
    .string()
    .optional()
    .nullable()
    .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), 'Invalid end date'),
  allDay: z.boolean().default(false),
  location: z.string().trim().max(200).optional().nullable(),
  thirdPartyId: z.string().trim().optional().nullable(),
  projectId: z.string().trim().optional().nullable(),
  owner: z.string().trim().max(120).optional().nullable(),
})

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 }
      )
    }
    const d = parsed.data

    if (d.thirdPartyId) {
      const tp = await db.thirdParty.findUnique({ where: { id: d.thirdPartyId } })
      if (!tp) {
        return NextResponse.json({ error: 'Third party not found' }, { status: 404 })
      }
    }

    const event = await db.agendaEvent.create({
      data: {
        title: d.title,
        description: d.description || null,
        type: d.type,
        start: new Date(d.start),
        end: d.end ? new Date(d.end) : null,
        allDay: d.allDay,
        location: d.location || null,
        thirdPartyId: d.thirdPartyId || null,
        projectId: d.projectId || null,
        owner: d.owner || null,
      },
      include: { thirdParty: { select: { id: true, name: true, code: true } } },
    })

    return NextResponse.json({ data: event }, { status: 201 })
  } catch (err) {
    console.error('POST /api/agenda failed', err)
    return NextResponse.json({ error: 'Failed to create agenda event' }, { status: 500 })
  }
}

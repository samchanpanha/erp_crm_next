import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { nextRef } from '@/lib/refs'

export const dynamic = 'force-dynamic'

const TICKET_STATUSES = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const
type TicketStatus = (typeof TICKET_STATUSES)[number]
const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
type TicketPriority = (typeof TICKET_PRIORITIES)[number]
const TICKET_CATEGORIES = ['SALES', 'BILLING', 'TECHNICAL', 'OTHER'] as const

/** Rank used for the priority sort: URGENT first */
const PRIORITY_RANK: Record<TicketPriority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
/** Tickets in these statuses are considered "open" and float to the top of the list */
const OPEN_STATUSES = new Set<string>(['NEW', 'ASSIGNED', 'IN_PROGRESS'])

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

const createSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(200, 'Subject is too long'),
  thirdPartyId: nullableText(100),
  contactId: nullableText(100),
  status: z.enum(TICKET_STATUSES).default('NEW'),
  priority: z.enum(TICKET_PRIORITIES).default('MEDIUM'),
  category: z.preprocess(
    (v) => (v === '' ? null : v),
    z.enum(TICKET_CATEGORIES).nullable().optional(),
  ),
  assignedTo: nullableText(120),
  description: nullableText(5000),
})

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

const ticketInclude = {
  thirdParty: { select: { id: true, name: true, code: true } },
} as const

/**
 * List sort order (documented choice):
 * 1. open tickets first (NEW / ASSIGNED / IN_PROGRESS), then RESOLVED, then CLOSED
 * 2. inside each group by priority rank (URGENT > HIGH > MEDIUM > LOW)
 * 3. newest createdAt first
 * SQLite + Prisma cannot sort by a custom status/priority mapping, so the
 * re-ordering happens in JS after the fetch (dataset is small).
 */
function sortTickets<T extends { status: string; priority: string; createdAt: Date | string }>(
  list: T[],
): T[] {
  return [...list].sort((a, b) => {
    const openDiff = (OPEN_STATUSES.has(a.status) ? 0 : 1) - (OPEN_STATUSES.has(b.status) ? 0 : 1)
    if (openDiff !== 0) return openDiff
    const prioDiff =
      (PRIORITY_RANK[a.priority as TicketPriority] ?? 9) -
      (PRIORITY_RANK[b.priority as TicketPriority] ?? 9)
    if (prioDiff !== 0) return prioDiff
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
}

// ---------------------------------------------------------------------------
// GET /api/tickets?q=&status=&priority=&category=&thirdPartyId= → { data: Ticket[] }
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const ctx = await requirePerm('tickets.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim() ?? ''
    const status = searchParams.get('status')?.trim() ?? ''
    const priority = searchParams.get('priority')?.trim() ?? ''
    const category = searchParams.get('category')?.trim() ?? ''
    const thirdPartyId = searchParams.get('thirdPartyId')?.trim() ?? ''

    const where: {
      tenantId?: string
      status?: TicketStatus
      priority?: TicketPriority
      category?: string
      thirdPartyId?: string
      OR?: (
        | { subject: { contains: string } }
        | { thirdParty: { is: { name: { contains: string } } } }
      )[]
    } = {}
    where.tenantId = user.tenantId

    if ((TICKET_STATUSES as readonly string[]).includes(status)) where.status = status as TicketStatus
    if ((TICKET_PRIORITIES as readonly string[]).includes(priority))
      where.priority = priority as TicketPriority
    if ((TICKET_CATEGORIES as readonly string[]).includes(category)) where.category = category
    if (thirdPartyId) where.thirdPartyId = thirdPartyId
    if (q) {
      where.OR = [
        { subject: { contains: q } },
        { thirdParty: { is: { name: { contains: q } } } },
      ]
    }

    const list = await db.ticket.findMany({ where, include: ticketInclude })

    return NextResponse.json({ data: sortTickets(list) })
  } catch (err) {
    console.error('GET /api/tickets failed', err)
    return bad('Failed to load tickets', 500)
  }
}

// ---------------------------------------------------------------------------
// POST /api/tickets → 201 { data: Ticket }
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  try {
    const ctx = await requirePerm('tickets.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))

    const { thirdPartyId, ...rest } = parsed.data

    if (thirdPartyId) {
      const tp = await db.thirdParty.findFirst({
        where: { id: thirdPartyId, tenantId: user.tenantId },
        select: { id: true },
      })
      if (!tp) return bad('Third party not found')
    }

    // Ref generation with bounded retry — the shared Sequence counter can lag
    // behind hard-coded seed refs, so a P2002 collision just consumes the
    // next number (same self-healing pattern as products / purchase orders).
    let created: Prisma.TicketGetPayload<{ include: typeof ticketInclude }> | null = null
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      try {
        const ref = await nextRef(user.tenantId, 'TK')
        created = await db.ticket.create({
          data: { ...rest, thirdPartyId: thirdPartyId ?? null, ref, tenantId: user.tenantId },
          include: ticketInclude,
        })
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
        throw e
      }
    }
    if (!created) return bad('Could not generate a unique ticket reference', 500)

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/tickets failed', err)
    return bad('Failed to create ticket', 500)
  }
}

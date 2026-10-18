import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const TICKET_STATUSES = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const
type TicketStatus = (typeof TICKET_STATUSES)[number]
const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
const TICKET_CATEGORIES = ['SALES', 'BILLING', 'TECHNICAL', 'OTHER'] as const

/**
 * Allowed status transitions:
 * - forward along NEW → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED, skipping is OK
 * - never backwards
 * - single exception: CLOSED → IN_PROGRESS (reopen)
 */
const STATUS_ORDER: Record<TicketStatus, number> = {
  NEW: 0,
  ASSIGNED: 1,
  IN_PROGRESS: 2,
  RESOLVED: 3,
  CLOSED: 4,
}

function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return true // no-op update
  if (from === 'CLOSED') return to === 'IN_PROGRESS' // reopen
  return STATUS_ORDER[to] > STATUS_ORDER[from]
}

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

const updateSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(200, 'Subject is too long').optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  category: z.preprocess(
    (v) => (v === '' ? null : v),
    z.enum(TICKET_CATEGORIES).nullable().optional(),
  ),
  assignedTo: optionalText(120),
  description: optionalText(5000),
  // "resolution" is usually sent together with status RESOLVED, but can also
  // be edited on its own (e.g. amend the fix notes of an already resolved ticket)
  resolution: optionalText(5000),
  thirdPartyId: optionalText(100),
  contactId: optionalText(100),
})

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

const ticketInclude = {
  thirdParty: { select: { id: true, name: true, code: true } },
} as const

// ---------------------------------------------------------------------------
// GET /api/tickets/:id → { data: Ticket & { messages: TicketMessage[] } }
// Messages are returned oldest-first so the UI can render a chat-like thread.
// ---------------------------------------------------------------------------
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('tickets.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const ticket = await db.ticket.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        ...ticketInclude,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!ticket) return bad('Ticket not found', 404)
    return NextResponse.json({ data: ticket })
  } catch (err) {
    console.error('GET /api/tickets/[id] failed', err)
    return bad('Failed to load ticket', 500)
  }
}

// ---------------------------------------------------------------------------
// PUT /api/tickets/:id → { data: Ticket }
// Field edits + status transitions. Setting status RESOLVED may include a
// { resolution } text in the same request.
// ---------------------------------------------------------------------------
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('tickets.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.ticket.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!existing) return bad('Ticket not found', 404)

    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))

    const sentCount = Object.values(parsed.data).filter((v) => v !== undefined).length
    if (sentCount === 0) return bad('No fields to update')

    const { status, thirdPartyId, ...rest } = parsed.data

    if (status) {
      const from = existing.status as TicketStatus
      if (!(TICKET_STATUSES as readonly string[]).includes(from))
        return bad(`Unknown current status: ${existing.status}`)
      if (!canTransition(from, status)) {
        return bad(
          `Invalid status transition: ${from.replaceAll('_', ' ')} → ${status.replaceAll('_', ' ')}`,
        )
      }
    }

    if (thirdPartyId !== undefined && thirdPartyId !== null) {
      const tp = await db.thirdParty.findFirst({
        where: { id: thirdPartyId, tenantId: user.tenantId },
        select: { id: true },
      })
      if (!tp) return bad('Third party not found')
    }

    const updated = await db.ticket.update({
      where: { id },
      data: {
        ...rest,
        ...(status !== undefined ? { status } : {}),
        ...(thirdPartyId !== undefined ? { thirdPartyId } : {}),
      },
      include: ticketInclude,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/tickets/[id] failed', err)
    return bad('Failed to update ticket', 500)
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/tickets/:id → { data: { ok: true } }  (messages cascade)
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('tickets.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.ticket.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!existing) return bad('Ticket not found', 404)

    await db.ticket.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/tickets/[id] failed', err)
    return bad('Failed to delete ticket', 500)
  }
}

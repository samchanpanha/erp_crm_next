import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const messageSchema = z.object({
  author: z
    .string()
    .trim()
    .min(1, 'Author is required')
    .max(120, 'Author is too long'),
  content: z
    .string()
    .trim()
    .min(1, 'Message content is required')
    .max(5000, 'Message is too long'),
  isInternal: z.boolean().default(false),
})

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

// ---------------------------------------------------------------------------
// POST /api/tickets/:id/messages → 201 { data: TicketMessage }
// Appends a message to the ticket thread. Internal notes are visible to
// agents only in the UI (amber left border + chip).
// ---------------------------------------------------------------------------
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('tickets.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const ticket = await db.ticket.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!ticket) return bad('Ticket not found', 404)

    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = messageSchema.safeParse(body)
    if (!parsed.success) {
      return bad(
        parsed.error.issues[0]?.message ?? 'Invalid message',
      )
    }

    const created = await db.ticketMessage.create({
      data: { ticketId: id, ...parsed.data },
    })

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/tickets/[id]/messages failed', err)
    return bad('Failed to add message', 500)
  }
}

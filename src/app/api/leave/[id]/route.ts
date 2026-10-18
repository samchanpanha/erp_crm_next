import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const TYPES = ['PAID', 'SICK', 'UNPAID', 'OTHER'] as const
const ACTIONS = ['approve', 'reject', 'cancel'] as const

type LeaveType = (typeof TYPES)[number]
type LeaveAction = (typeof ACTIONS)[number]

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
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

/** undefined untouched; '' -> invalid; date-like string -> Date */
const optionalDate = z.preprocess(
  (v) => {
    if (v === undefined) return undefined
    if (typeof v === 'string') {
      const d = new Date(v)
      return Number.isNaN(d.getTime()) ? v : d
    }
    return v
  },
  z.date({ error: 'Invalid date' }).optional(),
)

const employeeMini = { select: { id: true, firstName: true, lastName: true, employeeCode: true } } as const

/** Auto days = (end - start) in days + 1, rounded to 2 decimals */
function computeDays(start: Date, end: Date): number {
  return Math.round(((end.getTime() - start.getTime()) / 86400000 + 1) * 100) / 100
}

const ACTION_TO_STATUS: Record<LeaveAction, string> = {
  approve: 'APPROVED',
  reject: 'REJECTED',
  cancel: 'CANCELLED',
}

const putSchema = z.object({
  action: z.enum(ACTIONS).optional(),
  // edit fields (PENDING only, ignored when `action` is present)
  type: z.enum(TYPES).optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  days: z.coerce.number().positive('Days must be greater than 0').optional(),
  reason: optionalText(500),
})

// ---------------------------------------------------------------------------
// PUT /api/leave/:id → { data: LeaveRequest }
// - body.action = 'approve' | 'reject'  → allowed from PENDING only (else 400)
//   'cancel'                            → allowed from PENDING or APPROVED
// - otherwise: edit fields — allowed while PENDING only (else 400);
//   endDate >= startDate enforced against the merged dates; days recomputed
//   when absent and at least one date changed.
// ---------------------------------------------------------------------------
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.leaveRequest.findUnique({ where: { id } })
    if (!existing) return bad('Not found', 404)

    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = putSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))
    const { action, ...fields } = parsed.data

    // ---- workflow actions -------------------------------------------------
    if (action) {
      if (action === 'cancel') {
        if (existing.status !== 'PENDING' && existing.status !== 'APPROVED') {
          return bad(`Cannot cancel a ${existing.status.toLowerCase()} request`)
        }
      } else if (existing.status !== 'PENDING') {
        return bad(`Only pending requests can be ${action}d`)
      }

      const updated = await db.leaveRequest.update({
        where: { id },
        data: { status: ACTION_TO_STATUS[action] },
        include: { employee: employeeMini },
      })
      return NextResponse.json({ data: updated })
    }

    // ---- edit --------------------------------------------------------------
    if (existing.status !== 'PENDING') {
      return bad('Only pending requests can be edited')
    }

    const data: {
      type?: LeaveType
      startDate?: Date
      endDate?: Date
      days?: number
      reason?: string | null
    } = {}
    if (fields.type !== undefined) data.type = fields.type
    if (fields.startDate !== undefined) data.startDate = fields.startDate
    if (fields.endDate !== undefined) data.endDate = fields.endDate
    if (fields.reason !== undefined) data.reason = fields.reason

    if (Object.keys(data).length === 0) return bad('No fields to update')

    const start = data.startDate ?? existing.startDate
    const end = data.endDate ?? existing.endDate
    if (end.getTime() < start.getTime()) {
      return bad('End date must be on or after start date')
    }

    const datesChanged =
      data.startDate !== undefined &&
      data.startDate.getTime() !== existing.startDate.getTime()
        ? true
        : data.endDate !== undefined && data.endDate.getTime() !== existing.endDate.getTime()

    if (fields.days !== undefined) {
      data.days = fields.days
    } else if (datesChanged) {
      data.days = computeDays(start, end)
    }

    const updated = await db.leaveRequest.update({
      where: { id },
      data,
      include: { employee: employeeMini },
    })
    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/leave/[id] failed', err)
    return bad('Failed to update leave request', 500)
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/leave/:id — PENDING only (else 400)
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.leaveRequest.findUnique({ where: { id }, select: { id: true, status: true } })
    if (!existing) return bad('Not found', 404)

    if (existing.status !== 'PENDING') {
      return bad('Only pending requests can be deleted')
    }

    await db.leaveRequest.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/leave/[id] failed', err)
    return bad('Failed to delete leave request', 500)
  }
}

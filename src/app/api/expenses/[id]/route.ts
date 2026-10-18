import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const ACTIONS = ['submit', 'approve', 'reject', 'mark_paid'] as const
type ExpenseAction = (typeof ACTIONS)[number]

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

/** Allowed transitions: submit DRAFT→SUBMITTED, approve/reject SUBMITTED→APPROVED/REJECTED,
 *  mark_paid APPROVED→PAID */
const TRANSITIONS: Record<ExpenseAction, { from: string; to: string }> = {
  submit: { from: 'DRAFT', to: 'SUBMITTED' },
  approve: { from: 'SUBMITTED', to: 'APPROVED' },
  reject: { from: 'SUBMITTED', to: 'REJECTED' },
  mark_paid: { from: 'APPROVED', to: 'PAID' },
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

/** undefined / '' / null untouched (date column is non-nullable w/ default now) */
const optionalDate = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === '') return undefined
    if (typeof v === 'string') {
      const d = new Date(v)
      return Number.isNaN(d.getTime()) ? v : d
    }
    return v
  },
  z.date({ error: 'Invalid date' }).optional(),
)

const employeeMini = { select: { id: true, firstName: true, lastName: true, employeeCode: true } } as const

const putSchema = z.object({
  action: z.enum(ACTIONS).optional(),
  // edit fields (DRAFT only, ignored when `action` is present)
  employeeId: z.string().min(1).optional(),
  date: optionalDate,
  notes: optionalText(1000),
})

const detailInclude = {
  employee: employeeMini,
  lines: { orderBy: [{ date: 'asc' as const }] },
} satisfies Prisma.ExpenseReportInclude

// ---------------------------------------------------------------------------
// GET /api/expenses/:id → { data: ExpenseReport & { employee, lines } }
// ---------------------------------------------------------------------------
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('expenses.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const report = await db.expenseReport.findFirst({
      where: { id, tenantId: user.tenantId },
      include: detailInclude,
    })
    if (!report) return bad('Not found', 404)
    return NextResponse.json({ data: report })
  } catch (err) {
    console.error('GET /api/expenses/[id] failed', err)
    return bad('Failed to load expense report', 500)
  }
}

// ---------------------------------------------------------------------------
// PUT /api/expenses/:id → { data: ExpenseReport & { employee, lines } }
// - body.action = 'submit' | 'approve' | 'reject' | 'mark_paid' → guarded transition
// - otherwise: edit fields — DRAFT only (else 400)
// ---------------------------------------------------------------------------
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('expenses.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.expenseReport.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!existing) return bad('Not found', 404)

    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = putSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))
    const { action, ...fields } = parsed.data

    // ---- workflow actions ---------------------------------------------------
    if (action) {
      const t = TRANSITIONS[action]
      if (existing.status !== t.from) {
        return bad(
          action === 'submit'
            ? 'Only draft reports can be submitted'
            : `Cannot ${action.replace('_', ' ')}: report is ${existing.status}`,
        )
      }
      if (action === 'submit') {
        const lineCount = await db.expenseLine.count({ where: { reportId: id } })
        if (lineCount === 0) return bad('Cannot submit a report without expense lines')
      }

      const updated = await db.expenseReport.update({
        where: { id },
        data: { status: t.to },
        include: detailInclude,
      })
      return NextResponse.json({ data: updated })
    }

    // ---- edit ---------------------------------------------------------------
    if (existing.status !== 'DRAFT') {
      return bad('Only draft reports can be edited')
    }

    const data: Prisma.ExpenseReportUncheckedUpdateInput = {}
    if (fields.employeeId !== undefined) {
      const employee = await db.employee.findFirst({
        where: { id: fields.employeeId, tenantId: user.tenantId },
        select: { id: true },
      })
      if (!employee) return bad('Employee not found', 400)
      data.employeeId = fields.employeeId
    }
    if (fields.date !== undefined) data.date = fields.date
    if (fields.notes !== undefined) data.notes = fields.notes

    if (Object.keys(data).length === 0) return bad('No fields to update')

    const updated = await db.expenseReport.update({
      where: { id },
      data,
      include: detailInclude,
    })
    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/expenses/[id] failed', err)
    return bad('Failed to update expense report', 500)
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/expenses/:id — DRAFT only (else 400); lines cascade (schema)
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('expenses.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.expenseReport.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, status: true },
    })
    if (!existing) return bad('Not found', 404)

    if (existing.status !== 'DRAFT') {
      return bad('Only draft reports can be deleted')
    }

    await db.expenseReport.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/expenses/[id] failed', err)
    return bad('Failed to delete expense report', 500)
  }
}

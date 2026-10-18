import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const CATEGORIES = ['MEAL', 'TRAVEL', 'HOTEL', 'SUPPLIES', 'OTHER'] as const
type LineCategory = (typeof CATEGORIES)[number]

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

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

/** '' | null -> now; date-like string -> Date */
const lineDate = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === '') return new Date()
    if (typeof v === 'string') {
      const d = new Date(v)
      return Number.isNaN(d.getTime()) ? v : d
    }
    return v
  },
  z.date({ error: 'Invalid date' }),
)

const createLineSchema = z.object({
  category: z.enum(CATEGORIES).default('TRAVEL'),
  date: lineDate,
  amount: z.coerce
    .number({ error: 'Amount must be a number' })
    .positive('Amount must be greater than 0')
    .max(1_000_000, 'Amount is too large'),
  note: nullableText(300),
})

/** Recompute report.total = round2(Σ lines.amount) */
async function recomputeTotal(reportId: string): Promise<number> {
  const agg = await db.expenseLine.aggregate({
    where: { reportId },
    _sum: { amount: true },
  })
  const total = Math.round((agg._sum.amount ?? 0) * 100) / 100
  await db.expenseReport.update({ where: { id: reportId }, data: { total } })
  return total
}

// ---------------------------------------------------------------------------
// POST /api/expenses/:id/lines  →  201 { data: ExpenseLine }
// Only allowed while the report is DRAFT. Recomputes report.total server-side.
// ---------------------------------------------------------------------------
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('expenses.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const report = await db.expenseReport.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, status: true },
    })
    if (!report) return bad('Not found', 404)
    if (report.status !== 'DRAFT') {
      return bad('Expense lines can only be added while the report is a draft')
    }

    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = createLineSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))

    const [line, total] = await db.$transaction(async (tx) => {
      const created = await tx.expenseLine.create({
        data: {
          reportId: id,
          category: parsed.data.category,
          date: parsed.data.date,
          amount: parsed.data.amount,
          note: parsed.data.note,
        },
      })
      const agg = await tx.expenseLine.aggregate({
        where: { reportId: id },
        _sum: { amount: true },
      })
      const sum = Math.round((agg._sum.amount ?? 0) * 100) / 100
      await tx.expenseReport.update({ where: { id }, data: { total: sum } })
      return [created, sum] as const
    })

    return NextResponse.json({ data: { ...line, reportTotal: total } }, { status: 201 })
  } catch (err) {
    console.error('POST /api/expenses/[id]/lines failed', err)
    return bad('Failed to add expense line', 500)
  }
}

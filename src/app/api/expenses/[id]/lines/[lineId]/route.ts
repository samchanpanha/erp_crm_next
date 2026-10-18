import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

// ---------------------------------------------------------------------------
// DELETE /api/expenses/:id/lines/:lineId  →  { data: { ok, total } }
// Only allowed while the report is DRAFT. Recomputes report.total server-side.
// ---------------------------------------------------------------------------
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  try {
    const { id, lineId } = await params

    const report = await db.expenseReport.findUnique({
      where: { id },
      select: { id: true, status: true },
    })
    if (!report) return bad('Not found', 404)
    if (report.status !== 'DRAFT') {
      return bad('Expense lines can only be removed while the report is a draft')
    }

    const line = await db.expenseLine.findUnique({
      where: { id: lineId },
      select: { id: true, reportId: true },
    })
    if (!line || line.reportId !== id) return bad('Expense line not found', 404)

    const total = await db.$transaction(async (tx) => {
      await tx.expenseLine.delete({ where: { id: lineId } })
      const agg = await tx.expenseLine.aggregate({
        where: { reportId: id },
        _sum: { amount: true },
      })
      const sum = Math.round((agg._sum.amount ?? 0) * 100) / 100
      await tx.expenseReport.update({ where: { id }, data: { total: sum } })
      return sum
    })

    return NextResponse.json({ data: { ok: true, total } })
  } catch (err) {
    console.error('DELETE /api/expenses/[id]/lines/[lineId] failed', err)
    return bad('Failed to delete expense line', 500)
  }
}

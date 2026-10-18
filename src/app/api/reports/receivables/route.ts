import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

import { BUCKET_ORDER, bucketFor, daysOverdueOf, round2 } from '../_shared'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/reports/receivables — open customer invoices (UNPAID | PARTIAL)
// with an aging analysis (CURRENT / 1-30 / 31-60 / 61-90 / 90+ days overdue).
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const ctx = await requirePerm('reports.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const invoices = await db.invoice.findMany({
      where: { tenantId: user.tenantId, status: { in: ['UNPAID', 'PARTIAL'] } },
      include: { thirdParty: { select: { id: true, name: true, code: true } } },
    })
    const now = new Date()

    const rows = invoices
      .map((inv) => {
        const daysOverdue = daysOverdueOf(inv.dueDate, now)
        return {
          id: inv.id,
          ref: inv.ref,
          status: inv.status,
          customer: { name: inv.thirdParty.name, code: inv.thirdParty.code },
          date: inv.date.toISOString(),
          dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
          total: round2(inv.total),
          paidAmount: round2(inv.paidAmount),
          dueAmount: round2(inv.total - inv.paidAmount),
          daysOverdue,
          bucket: bucketFor(daysOverdue),
        }
      })
      .sort(
        (a, b) =>
          b.daysOverdue - a.daysOverdue ||
          (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
          a.ref.localeCompare(b.ref)
      )

    const summary = BUCKET_ORDER.map((bucket) => {
      const inBucket = rows.filter((r) => r.bucket === bucket)
      return {
        bucket,
        count: inBucket.length,
        amount: round2(inBucket.reduce((s, r) => s + r.dueAmount, 0)),
      }
    })

    const totalDue = round2(rows.reduce((s, r) => s + r.dueAmount, 0))
    const overdueAmount = round2(
      rows.filter((r) => r.bucket !== 'CURRENT').reduce((s, r) => s + r.dueAmount, 0)
    )

    return NextResponse.json({
      data: {
        rows,
        summary,
        totals: { totalDue, overdueAmount },
        asOf: now.toISOString(),
      },
    })
  } catch (err) {
    console.error('GET /api/reports/receivables failed', err)
    return NextResponse.json({ error: 'Failed to load receivables report' }, { status: 500 })
  }
}

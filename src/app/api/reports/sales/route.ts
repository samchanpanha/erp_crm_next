import { NextResponse } from 'next/server'
import { z } from 'zod'

import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

import {
  dayEnd,
  monthKey,
  monthKeysBetween,
  optionalDateParam,
  parseDateParam,
  round2,
  startOfYear,
} from '../_shared'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/reports/sales?months=12&from=&to=
// Monthly revenue (Σ non-draft/non-cancelled Invoice.total by invoice.date)
// vs collected (Σ customer Payment.amount by payment.date) for a window.
// Window = [from, to] when provided, else the last `months` months.
// ---------------------------------------------------------------------------
const querySchema = z.object({
  months: z.coerce.number().int().min(1).max(60).optional(),
  from: optionalDateParam('from'),
  to: optionalDateParam('to'),
})

const STATUS_ORDER = ['UNPAID', 'PARTIAL', 'PAID', 'CANCELLED'] as const

export async function GET(request: Request) {
  try {
    const ctx = await requirePerm('reports.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid query' },
        { status: 400 }
      )
    }
    const { months, from: fromRaw, to: toRaw } = parsed.data
    const now = new Date()
    const fromP = parseDateParam(fromRaw)
    const toP = parseDateParam(toRaw)

    let windowStart: Date
    let windowEnd: Date
    if (fromP || toP) {
      windowStart = fromP ?? startOfYear(now)
      windowEnd = toP ? dayEnd(toP) : now
    } else {
      windowEnd = now
      windowStart = new Date(now.getFullYear(), now.getMonth() - ((months ?? 12) - 1), 1)
    }
    if (windowStart.getTime() > windowEnd.getTime()) {
      return NextResponse.json({ error: '"from" must be before "to"' }, { status: 400 })
    }

    const [invoices, payments] = await Promise.all([
      db.invoice.findMany({
        where: { tenantId: user.tenantId, status: { not: 'DRAFT' }, date: { gte: windowStart, lte: windowEnd } },
        select: { status: true, total: true, paidAmount: true, date: true },
      }),
      db.payment.findMany({
        where: { tenantId: user.tenantId, invoiceId: { not: null }, date: { gte: windowStart, lte: windowEnd } },
        select: { amount: true, date: true },
      }),
    ])

    const revenueByMonth = new Map<string, number>()
    const collectedByMonth = new Map<string, number>()
    for (const inv of invoices) {
      if (inv.status === 'CANCELLED') continue
      const key = monthKey(inv.date)
      revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + inv.total)
    }
    for (const p of payments) {
      const key = monthKey(p.date)
      collectedByMonth.set(key, (collectedByMonth.get(key) ?? 0) + p.amount)
    }

    const series = monthKeysBetween(windowStart, windowEnd).map((month) => ({
      month,
      revenue: round2(revenueByMonth.get(month) ?? 0),
      collected: round2(collectedByMonth.get(month) ?? 0),
    }))

    const revenue = round2(
      invoices.reduce((s, i) => (i.status === 'CANCELLED' ? s : s + i.total), 0)
    )
    const collected = round2(payments.reduce((s, p) => s + p.amount, 0))
    const outstanding = round2(
      invoices.reduce(
        (s, i) => (i.status === 'UNPAID' || i.status === 'PARTIAL' ? s + (i.total - i.paidAmount) : s),
        0
      )
    )

    const byStatus = new Map<string, { count: number; total: number }>()
    for (const inv of invoices) {
      const entry = byStatus.get(inv.status) ?? { count: 0, total: 0 }
      entry.count += 1
      entry.total += inv.total
      byStatus.set(inv.status, entry)
    }
    const statusBreakdown = STATUS_ORDER.filter((s) => byStatus.has(s)).map((status) => {
      const entry = byStatus.get(status)!
      return { status, count: entry.count, total: round2(entry.total) }
    })

    return NextResponse.json({
      data: {
        window: { from: windowStart.toISOString(), to: windowEnd.toISOString() },
        series,
        totals: { revenue, collected, outstanding },
        statusBreakdown,
      },
    })
  } catch (err) {
    console.error('GET /api/reports/sales failed', err)
    return NextResponse.json({ error: 'Failed to load sales report' }, { status: 500 })
  }
}

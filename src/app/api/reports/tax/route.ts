import { NextResponse } from 'next/server'
import { z } from 'zod'

import { db } from '@/lib/db'
import { computeLineTotal, computeLineVat, round2 } from '@/lib/doc-math'

import { dayEnd, optionalDateParam, parseDateParam, startOfYear } from '../_shared'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/reports/tax?from=&to= — VAT summary by rate, computed from the
// invoice lines of non-draft/non-cancelled invoices dated in the window.
// net = Σ line total (ex-VAT), vat = Σ per-line VAT at the line's rate.
// ---------------------------------------------------------------------------
const querySchema = z.object({
  from: optionalDateParam('from'),
  to: optionalDateParam('to'),
})

export async function GET(request: Request) {
  try {
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid query' },
        { status: 400 }
      )
    }
    const { from: fromRaw, to: toRaw } = parsed.data
    const now = new Date()
    const fromP = parseDateParam(fromRaw)
    const toP = parseDateParam(toRaw)
    const windowStart = fromP ?? startOfYear(now)
    const windowEnd = toP ? dayEnd(toP) : now
    if (windowStart.getTime() > windowEnd.getTime()) {
      return NextResponse.json({ error: '"from" must be before "to"' }, { status: 400 })
    }

    const lines = await db.invoiceLine.findMany({
      where: { invoice: { status: { notIn: ['DRAFT', 'CANCELLED'] }, date: { gte: windowStart, lte: windowEnd } } },
      select: { qty: true, unitPrice: true, discountPct: true, vatRate: true },
    })

    const byRate = new Map<number, { net: number; vat: number }>()
    for (const line of lines) {
      const rate = line.vatRate ?? 20
      const entry = byRate.get(rate) ?? { net: 0, vat: 0 }
      entry.net += computeLineTotal(line)
      entry.vat += computeLineVat(line)
      byRate.set(rate, entry)
    }

    const rows = [...byRate.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rate, e]) => ({ rate, net: round2(e.net), vat: round2(e.vat) }))

    return NextResponse.json({
      data: {
        window: { from: windowStart.toISOString(), to: windowEnd.toISOString() },
        rows,
        totals: {
          net: round2(rows.reduce((s, r) => s + r.net, 0)),
          vat: round2(rows.reduce((s, r) => s + r.vat, 0)),
        },
      },
    })
  } catch (err) {
    console.error('GET /api/reports/tax failed', err)
    return NextResponse.json({ error: 'Failed to load tax report' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { computeLineTotal, round2 } from '@/lib/doc-math'

import { dayEnd, optionalDateParam, parseDateParam, startOfYear } from '../_shared'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/reports/top?type=customers|products&limit=10&from=&to=
// customers: non-draft/non-cancelled invoices grouped by third party.
// products:  their invoice lines (with a product) grouped by product,
//            amount = Σ computeLineTotal(line).
// ---------------------------------------------------------------------------
const querySchema = z.object({
  type: z.enum(['customers', 'products']).default('customers'),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  from: optionalDateParam('from'),
  to: optionalDateParam('to'),
})

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
    const { type, limit, from: fromRaw, to: toRaw } = parsed.data
    const now = new Date()
    const fromP = parseDateParam(fromRaw)
    const toP = parseDateParam(toRaw)
    const windowStart = fromP ?? startOfYear(now)
    const windowEnd = toP ? dayEnd(toP) : now
    if (windowStart.getTime() > windowEnd.getTime()) {
      return NextResponse.json({ error: '"from" must be before "to"' }, { status: 400 })
    }

    const invoiceFilter = {
      tenantId: user.tenantId,
      status: { notIn: ['DRAFT', 'CANCELLED'] },
      date: { gte: windowStart, lte: windowEnd },
    }

    if (type === 'customers') {
      const invoices = await db.invoice.findMany({
        where: invoiceFilter,
        select: {
          total: true,
          paidAmount: true,
          thirdPartyId: true,
          thirdParty: { select: { id: true, name: true, code: true } },
        },
      })

      const byThirdParty = new Map<string, { id: string; name: string; code: string; invoiceCount: number; revenue: number; paid: number }>()
      for (const inv of invoices) {
        const entry = byThirdParty.get(inv.thirdPartyId) ?? {
          id: inv.thirdParty.id,
          name: inv.thirdParty.name,
          code: inv.thirdParty.code,
          invoiceCount: 0,
          revenue: 0,
          paid: 0,
        }
        entry.invoiceCount += 1
        entry.revenue += inv.total
        entry.paid += inv.paidAmount
        byThirdParty.set(inv.thirdPartyId, entry)
      }

      const all = [...byThirdParty.values()]
        .map((e) => ({ ...e, revenue: round2(e.revenue), paid: round2(e.paid) }))
        .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name))

      return NextResponse.json({
        data: {
          type,
          window: { from: windowStart.toISOString(), to: windowEnd.toISOString() },
          rows: all.slice(0, limit),
          total: round2(all.reduce((s, e) => s + e.revenue, 0)),
        },
      })
    }

    const lines = await db.invoiceLine.findMany({
      where: { productId: { not: null }, invoice: invoiceFilter },
      select: { productId: true, qty: true, unitPrice: true, discountPct: true, vatRate: true },
    })

    // InvoiceLine carries a loose productId (no Prisma relation) → aggregate
    // first, then hydrate ref/label with one product query.
    const aggByProduct = new Map<string, { qty: number; amount: number }>()
    for (const line of lines) {
      if (!line.productId) continue
      const entry = aggByProduct.get(line.productId) ?? { qty: 0, amount: 0 }
      entry.qty += line.qty
      entry.amount += computeLineTotal(line)
      aggByProduct.set(line.productId, entry)
    }

    const products = aggByProduct.size
      ? await db.product.findMany({
          where: { id: { in: [...aggByProduct.keys()] }, tenantId: user.tenantId },
          select: { id: true, ref: true, label: true },
        })
      : []

    const all = products
      .map((p) => {
        const agg = aggByProduct.get(p.id)
        return {
          id: p.id,
          ref: p.ref,
          label: p.label,
          qty: round2(agg?.qty ?? 0),
          amount: round2(agg?.amount ?? 0),
        }
      })
      .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label))

    return NextResponse.json({
      data: {
        type,
        window: { from: windowStart.toISOString(), to: windowEnd.toISOString() },
        rows: all.slice(0, limit),
        total: round2(all.reduce((s, e) => s + e.amount, 0)),
      },
    })
  } catch (err) {
    console.error('GET /api/reports/top failed', err)
    return NextResponse.json({ error: 'Failed to load top lists report' }, { status: 500 })
  }
}

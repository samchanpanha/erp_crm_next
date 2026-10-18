import { NextResponse } from 'next/server'

import { db } from '@/lib/db'

import { round2 } from '../_shared'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/reports/inventory — stock valuation of all PRODUCT-type items
// (stockValue = stockQty × costPrice), low = stockQty <= minStock.
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const products = await db.product.findMany({
      where: { type: 'PRODUCT' },
      select: { id: true, ref: true, label: true, stockQty: true, minStock: true, costPrice: true },
    })

    const rows = products
      .map((p) => ({
        id: p.id,
        ref: p.ref,
        label: p.label,
        stockQty: p.stockQty,
        minStock: p.minStock,
        costPrice: round2(p.costPrice),
        stockValue: round2(p.stockQty * p.costPrice),
        low: p.stockQty <= p.minStock,
      }))
      .sort((a, b) => b.stockValue - a.stockValue || a.ref.localeCompare(b.ref))

    return NextResponse.json({
      data: {
        rows,
        totals: {
          totalValue: round2(rows.reduce((s, r) => s + r.stockValue, 0)),
          lowCount: rows.filter((r) => r.low).length,
          productCount: rows.length,
        },
        asOf: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error('GET /api/reports/inventory failed', err)
    return NextResponse.json({ error: 'Failed to load inventory report' }, { status: 500 })
  }
}

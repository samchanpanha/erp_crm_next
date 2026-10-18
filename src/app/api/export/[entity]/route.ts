import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { stringifyCsv } from '@/lib/csv'

export const dynamic = 'force-dynamic'

/**
 * GET /api/export/[entity]
 * Server-generated CSV export ('third-parties' | 'products').
 * Uses EXACTLY the same headers as the import templates so an exported file
 * can be re-imported without changes. Capped at 10 000 rows.
 * A UTF-8 BOM is prepended so Excel opens the file with correct encoding
 * (our parseCsv strips it on re-import).
 */

const TP_HEADERS = [
  'code', 'name', 'type', 'status', 'email', 'phone', 'website', 'address',
  'zip', 'city', 'country', 'vatNumber', 'currency', 'paymentTerms', 'notes',
]

const PRODUCT_HEADERS = [
  'ref', 'label', 'type', 'description', 'unit', 'sellPrice', 'costPrice',
  'vatRate', 'barcode', 'manageStock', 'stockQty', 'minStock', 'status',
]

const MAX_EXPORT_ROWS = 10000

function dateStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

export async function GET(_req: Request, { params }: { params: Promise<{ entity: string }> }) {
  try {
    const { entity } = await params

    if (entity === 'third-parties') {
      const rows = await db.thirdParty.findMany({
        orderBy: { createdAt: 'desc' },
        take: MAX_EXPORT_ROWS,
      })
      const csvRows = rows.map((t) => ({
        code: t.code,
        name: t.name,
        type: t.type,
        status: t.status,
        email: t.email,
        phone: t.phone,
        website: t.website,
        address: t.address,
        zip: t.zip,
        city: t.city,
        country: t.country,
        vatNumber: t.vatNumber,
        currency: t.currency,
        paymentTerms: t.paymentTerms,
        notes: t.notes,
      }))
      const csv = '\uFEFF' + stringifyCsv(TP_HEADERS, csvRows)
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="third-parties-${dateStamp()}.csv"`,
        },
      })
    }

    if (entity === 'products') {
      const rows = await db.product.findMany({
        orderBy: { createdAt: 'desc' },
        take: MAX_EXPORT_ROWS,
      })
      const csvRows = rows.map((p) => ({
        ref: p.ref,
        label: p.label,
        type: p.type,
        description: p.description,
        unit: p.unit,
        sellPrice: p.sellPrice,
        costPrice: p.costPrice,
        vatRate: p.vatRate,
        barcode: p.barcode,
        manageStock: p.manageStock ? 'yes' : 'no',
        stockQty: p.stockQty,
        minStock: p.minStock,
        status: p.status,
      }))
      const csv = '\uFEFF' + stringifyCsv(PRODUCT_HEADERS, csvRows)
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="products-${dateStamp()}.csv"`,
        },
      })
    }

    return NextResponse.json({ error: `Unknown export entity "${entity}"` }, { status: 404 })
  } catch (err) {
    console.error('GET /api/export failed', err)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}

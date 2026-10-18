import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { IMPORT_CONFIG, isImportEntity } from '@/lib/import-config'
import { buildWorkbookBuffer, buildTemplateBuffer, xlsxResponse } from '@/lib/excel'

export const dynamic = 'force-dynamic'

/**
 * GET /api/export/[entity]            → Excel .xlsx export of all records
 * GET /api/export/[entity]?template=1 → styled .xlsx import template (headers + samples)
 * Entities: 'third-parties' | 'products'.
 * Uses EXACTLY the same headers as the import pipeline so an exported file can
 * be re-imported without changes. Capped at 10 000 rows.
 */

const MAX_EXPORT_ROWS = 10000

function dateStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

export async function GET(req: Request, { params }: { params: Promise<{ entity: string }> }) {
  try {
    const { entity } = await params
    if (!isImportEntity(entity)) {
      return NextResponse.json({ error: `Unknown export entity "${entity}"` }, { status: 404 })
    }
    const cfg = IMPORT_CONFIG[entity]
    const isTemplate = new URL(req.url).searchParams.get('template') === '1'

    if (isTemplate) {
      const buffer = await buildTemplateBuffer(cfg.sheetName, cfg.headers, cfg.templateRows)
      return xlsxResponse(`template-${entity}.xlsx`, buffer)
    }

    let rows: Record<string, unknown>[]
    if (entity === 'third-parties') {
      const all = await db.thirdParty.findMany({
        orderBy: { createdAt: 'desc' },
        take: MAX_EXPORT_ROWS,
      })
      rows = all.map((t) => ({
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
    } else {
      const all = await db.product.findMany({
        orderBy: { createdAt: 'desc' },
        take: MAX_EXPORT_ROWS,
      })
      rows = all.map((p) => ({
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
    }

    const buffer = await buildWorkbookBuffer({
      sheetName: cfg.sheetName,
      headers: cfg.headers,
      rows,
      title: `${cfg.label.toUpperCase()} — exported from DoliNext on ${new Date().toISOString().slice(0, 10)} (${rows.length} records)`,
    })
    return xlsxResponse(`${entity}-${dateStamp()}.xlsx`, buffer)
  } catch (err) {
    console.error('GET /api/export failed', err)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildWorkbookBuffer, xlsxResponse } from '@/lib/excel'

export const dynamic = 'force-dynamic'

/**
 * POST /api/export/xlsx — ad-hoc Excel download used by the Reports module.
 * Body: { filename, sheetName, headers, rows } → a styled .xlsx attachment.
 * Server-side generation keeps heavy spreadsheet deps out of the client bundle.
 */

const bodySchema = z.object({
  filename: z.string().trim().min(1).max(120).regex(/^[\w.-]+\.xlsx$/, 'Filename must be like report-sales.xlsx'),
  sheetName: z.string().trim().min(1).max(31).default('Report'),
  headers: z.array(z.string().min(1).max(120)).min(1).max(100),
  rows: z.array(z.record(z.string(), z.unknown())).max(10000, 'Rows are limited to 10 000 per export'),
})

function safe(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 },
      )
    }
    const { filename, sheetName, headers, rows } = parsed.data

    const buffer = await buildWorkbookBuffer({
      sheetName,
      headers,
      rows: rows.map((r) => Object.fromEntries(headers.map((h) => [h, safe(r[h])]))),
    })
    return xlsxResponse(filename, buffer)
  } catch (err) {
    console.error('POST /api/export/xlsx failed', err)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}

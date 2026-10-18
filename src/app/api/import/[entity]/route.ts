import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { nextRef, REF_PREFIX } from '@/lib/refs'
import { IMPORT_CONFIG, isImportEntity } from '@/lib/import-config'
import { parseSpreadsheetFile } from '@/lib/excel'

export const dynamic = 'force-dynamic'

/**
 * POST /api/import/[entity]
 * Server-validated bulk import for 'third-parties' | 'products'.
 * Two transports:
 *  1) JSON body: { rows: Record<string,string>[], dryRun?: boolean }
 *  2) multipart/form-data: file=<.xlsx|.xls|.csv upload>, dryRun='true'|'false'
 *     - ?mode=preview  → { headers, rowCount, rows(first 5), missingRequired, kind }
 *                        (parses + checks headers only, writes nothing)
 *     - otherwise      → full import: { imported, updated, skipped, errors }
 * Rows are mapped + validated one-by-one (errors are collected per row,
 * processing continues). `code` / `ref` behave as an upsert key: a value
 * updates the existing record, an empty value auto-generates one via the
 * same helper the create APIs use (nextRef + P2002 retry).
 */

const ENTITIES = ['third-parties', 'products'] as const
type Entity = (typeof ENTITIES)[number]

const MAX_ROWS = 5000
const MAX_ERRORS = 50
const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2 MB upload guard
const PREVIEW_ROW_COUNT = 5

const importSchema = z.object({
  rows: z.array(z.record(z.string(), z.string())).max(MAX_ROWS, `Rows are limited to ${MAX_ROWS} per import`),
  dryRun: z.boolean().default(false),
})

/** Validation failure for a single row (does not abort the import) */
class ImportError extends Error {}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const TP_TYPES = new Set(['CUSTOMER', 'PROSPECT', 'SUPPLIER', 'CUSTOMER_SUPPLIER'])
const TP_PAYMENT_TERMS = new Set(['ON_ORDER', 'NET15', 'NET30', 'NET60'])
const STATUSES = new Set(['ACTIVE', 'SUSPENDED'])

/** optional text fields -> max length (mirrors the create API schemas) */
const TP_TEXT_FIELDS: [field: string, max: number][] = [
  ['phone', 50],
  ['website', 200],
  ['address', 300],
  ['zip', 20],
  ['city', 100],
  ['country', 100],
  ['vatNumber', 50],
  ['notes', 2000],
]

const FIELD_LABELS: Record<string, string> = {
  phone: 'Phone',
  website: 'Website',
  address: 'Address',
  zip: 'ZIP',
  city: 'City',
  country: 'Country',
  vatNumber: 'VAT number',
  notes: 'Notes',
}

/** Validates length and returns '' | null | trimmed value for optional text columns */
function optionalText(row: Record<string, string>, field: string, max: number): string | null {
  const v = (row[field] ?? '').trim()
  if (v.length > max) {
    throw new ImportError(`${FIELD_LABELS[field] ?? field} is too long (max ${max} characters)`)
  }
  return v || null
}

/**
 * Numbers may be written as "1234.56" or "1,234.56" (commas/spaces stripped).
 * Empty -> fallback. Anything non-numeric or negative is a row error.
 */
function parseNumberField(value: string | undefined, label: string, fallback: number): number {
  const raw = (value ?? '').trim()
  if (!raw) return fallback
  const n = Number(raw.replace(/[,\s]/g, ''))
  if (!Number.isFinite(n) || n < 0) {
    throw new ImportError(`${label} must be a number ≥ 0 (got "${raw}")`)
  }
  return n
}

function parseIntField(value: string | undefined, label: string, fallback: number): number {
  const raw = (value ?? '').trim()
  if (!raw) return fallback
  const n = Number(raw.replace(/[,\s]/g, ''))
  if (!Number.isInteger(n) || n < 0) {
    throw new ImportError(`${label} must be a whole number ≥ 0 (got "${raw}")`)
  }
  return n
}

/** 'yes'/'true'/'1' -> true; 'no'/'false'/'0' -> false; empty -> null (unset) */
function parseBoolField(value: string | undefined, label: string): boolean | null {
  const raw = (value ?? '').trim().toLowerCase()
  if (!raw) return null
  if (['yes', 'true', '1', 'y'].includes(raw)) return true
  if (['no', 'false', '0', 'n'].includes(raw)) return false
  throw new ImportError(`${label} must be yes or no (got "${value}")`)
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

// ---------------------------------------------------------------------------
// Third parties
// ---------------------------------------------------------------------------
interface ThirdPartyData {
  name: string
  type: string
  status: string
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  zip: string | null
  city: string | null
  country: string | null
  vatNumber: string | null
  currency: string
  paymentTerms: string
  notes: string | null
}

async function processThirdPartyRow(row: Record<string, string>, dryRun: boolean): Promise<'created' | 'updated'> {
  const name = (row.name ?? '').trim()
  if (!name) throw new ImportError('Name is required')
  if (name.length > 200) throw new ImportError('Name is too long (max 200 characters)')

  const type = (row.type ?? '').trim() || 'CUSTOMER'
  if (!TP_TYPES.has(type)) {
    throw new ImportError(`Invalid type "${type}" — expected one of: ${[...TP_TYPES].join(', ')}`)
  }

  const status = (row.status ?? '').trim() || 'ACTIVE'
  if (!STATUSES.has(status)) {
    throw new ImportError(`Invalid status "${status}" — expected ACTIVE or SUSPENDED`)
  }

  const email = (row.email ?? '').trim()
  if (email) {
    if (email.length > 200) throw new ImportError('Email is too long (max 200 characters)')
    if (!EMAIL_RE.test(email)) throw new ImportError(`Invalid email address "${email}"`)
  }

  const currency = ((row.currency ?? '').trim() || 'USD').toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ImportError(`Invalid currency "${currency}" — expected a 3-letter code (e.g. USD)`)
  }

  const paymentTerms = (row.paymentTerms ?? '').trim() || 'NET30'
  if (!TP_PAYMENT_TERMS.has(paymentTerms)) {
    throw new ImportError(`Invalid payment terms "${paymentTerms}" — expected one of: ${[...TP_PAYMENT_TERMS].join(', ')}`)
  }

  const data: ThirdPartyData = {
    name,
    type,
    status,
    email: email || null,
    phone: optionalText(row, 'phone', 50),
    website: optionalText(row, 'website', 200),
    address: optionalText(row, 'address', 300),
    zip: optionalText(row, 'zip', 20),
    city: optionalText(row, 'city', 100),
    country: optionalText(row, 'country', 100),
    vatNumber: optionalText(row, 'vatNumber', 50),
    currency,
    paymentTerms,
    notes: optionalText(row, 'notes', 2000),
  }

  const code = (row.code ?? '').trim()
  if (code) {
    const existing = await db.thirdParty.findUnique({ where: { code }, select: { id: true } })
    if (existing) {
      if (!dryRun) await db.thirdParty.update({ where: { code }, data })
      return 'updated'
    }
    try {
      if (!dryRun) await db.thirdParty.create({ data: { ...data, code } })
      return 'created'
    } catch (e) {
      // Rare race: the code was created between findUnique and create -> update instead
      if (!isUniqueViolation(e)) throw e
      if (!dryRun) await db.thirdParty.update({ where: { code }, data })
      return 'updated'
    }
  }

  // No code provided -> auto-generate with the same helper as POST /api/third-parties
  if (dryRun) return 'created'
  for (let attempt = 0; attempt < 30; attempt++) {
    const generated = await nextRef(REF_PREFIX.thirdParty)
    try {
      await db.thirdParty.create({ data: { ...data, code: generated } })
      return 'created'
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
    }
  }
  throw new Error('Could not generate a unique code for this row')
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
interface ProductData {
  label: string
  type: string
  description: string | null
  unit: string
  sellPrice: number
  costPrice: number
  vatRate: number
  barcode: string | null
  manageStock: boolean
  stockQty: number
  minStock: number
  status: string
}

function productUpdateData(data: ProductData): Record<string, unknown> {
  // NOTE: stockQty is intentionally NOT updated on existing products — stock
  // changes must go through /api/stock so the movement audit trail stays
  // consistent (same rule as PUT /api/products/[id]). Only a forced
  // !manageStock resets it to 0, mirroring the PUT endpoint.
  const updateData: Record<string, unknown> = { ...data }
  delete updateData.stockQty
  if (!data.manageStock) updateData.stockQty = 0
  return updateData
}

async function processProductRow(row: Record<string, string>, dryRun: boolean): Promise<'created' | 'updated'> {
  const label = (row.label ?? '').trim()
  if (!label) throw new ImportError('Label is required')
  if (label.length > 200) throw new ImportError('Label is too long (max 200 characters)')

  const type = (row.type ?? '').trim() || 'PRODUCT'
  if (type !== 'PRODUCT' && type !== 'SERVICE') {
    throw new ImportError(`Invalid type "${type}" — expected PRODUCT or SERVICE`)
  }

  const description = (row.description ?? '').trim()
  if (description.length > 2000) throw new ImportError('Description is too long (max 2000 characters)')

  const unit = (row.unit ?? '').trim() || 'unit'
  if (unit.length > 50) throw new ImportError('Unit is too long (max 50 characters)')

  const sellPrice = parseNumberField(row.sellPrice, 'Sell price', 0)
  const costPrice = parseNumberField(row.costPrice, 'Cost price', 0)
  const vatRate = parseNumberField(row.vatRate, 'VAT rate', 20)
  if (vatRate > 100) throw new ImportError('VAT rate must be between 0 and 100')

  const stockQty = parseIntField(row.stockQty, 'Stock quantity', 0)
  const minStock = parseIntField(row.minStock, 'Minimum stock', 0)
  const manageStockRaw = parseBoolField(row.manageStock, 'manageStock')

  const status = (row.status ?? '').trim() || 'ACTIVE'
  if (!STATUSES.has(status)) {
    throw new ImportError(`Invalid status "${status}" — expected ACTIVE or SUSPENDED`)
  }

  const barcode = (row.barcode ?? '').trim()
  if (barcode.length > 100) throw new ImportError('Barcode is too long (max 100 characters)')

  // Services never manage stock (mirrors the create/update API rules)
  const manageStock = type === 'SERVICE' ? false : manageStockRaw ?? true
  const effStockQty = manageStock ? stockQty : 0
  const effMinStock = manageStock ? minStock : 0

  const data: ProductData = {
    label,
    type,
    description: description || null,
    unit,
    sellPrice,
    costPrice,
    vatRate,
    barcode: barcode || null,
    manageStock,
    stockQty: effStockQty,
    minStock: effMinStock,
    status,
  }

  const ref = (row.ref ?? '').trim()
  if (ref) {
    const existing = await db.product.findUnique({ where: { ref }, select: { id: true } })
    if (existing) {
      if (!dryRun) await db.product.update({ where: { ref }, data: productUpdateData(data) })
      return 'updated'
    }
    try {
      if (!dryRun) await createProduct({ ...data, ref })
      return 'created'
    } catch (e) {
      // Rare race: the ref was created between findUnique and create -> update instead
      if (!isUniqueViolation(e)) throw e
      if (!dryRun) await db.product.update({ where: { ref }, data: productUpdateData(data) })
      return 'updated'
    }
  }

  // No ref provided -> auto-generate with the same helper as POST /api/products
  if (dryRun) return 'created'
  for (let attempt = 0; attempt < 30; attempt++) {
    const generated = await nextRef(REF_PREFIX.product)
    try {
      await createProduct({ ...data, ref: generated })
      return 'created'
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
    }
  }
  throw new Error('Could not generate a unique ref for this row')
}

/** Create a product + trace the initial stock as an IN movement (like POST /api/products) */
async function createProduct(data: ProductData & { ref: string }) {
  const created = await db.product.create({ data })
  if (data.manageStock && data.stockQty > 0) {
    const defaultWarehouse = await db.warehouse.findFirst({ where: { isDefault: true } })
    await db.stockMovement.create({
      data: {
        productId: created.id,
        warehouseId: defaultWarehouse?.id ?? null,
        type: 'IN',
        qty: data.stockQty,
        reference: 'INITIAL',
        note: 'Initial stock set on CSV import',
      },
    })
  }
  return created
}

// ---------------------------------------------------------------------------
// POST /api/import/[entity]
// ---------------------------------------------------------------------------
interface ImportResult {
  imported: number
  updated: number
  skipped: number
  errors: { row: number; message: string }[]
}

async function runImport(entity: Entity, rows: Record<string, string>[], dryRun: boolean): Promise<ImportResult> {
  const processRow = entity === 'third-parties' ? processThirdPartyRow : processProductRow
  let imported = 0
  let updated = 0
  const allErrors: { row: number; message: string }[] = []

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1 // 1-based data row (matches the wizard preview)
    try {
      const outcome = await processRow(rows[i], dryRun)
      if (outcome === 'created') imported++
      else updated++
    } catch (e) {
      allErrors.push({
        row: rowNum,
        message: e instanceof ImportError ? e.message : 'Unexpected error while importing this row',
      })
    }
  }

  const truncated = allErrors.length > MAX_ERRORS
  const errors = truncated
    ? [...allErrors.slice(0, MAX_ERRORS), { row: 0, message: `…and ${allErrors.length - MAX_ERRORS} more` }]
    : allErrors

  return { imported, updated, skipped: allErrors.length, errors }
}

function missingRequiredColumns(entity: Entity, headers: string[]): string[] {
  return IMPORT_CONFIG[entity].required.filter((h) => !headers.includes(h))
}

export async function POST(req: Request, { params }: { params: Promise<{ entity: string }> }) {
  try {
    const { entity } = await params
    if (!isImportEntity(entity)) {
      return NextResponse.json({ error: `Unknown import entity "${entity}"` }, { status: 404 })
    }

    const contentType = req.headers.get('content-type') ?? ''

    // ---- Transport A: multipart file upload (Excel / CSV) -----------------
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData().catch(() => null)
      const file = form?.get('file')
      if (!form || !(file instanceof File)) {
        return NextResponse.json({ error: 'Missing file — attach a spreadsheet in the "file" field' }, { status: 400 })
      }
      if (file.size === 0) {
        return NextResponse.json({ error: 'The uploaded file is empty' }, { status: 400 })
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `File is too large (${Math.round(file.size / 1024)} KB — the limit is ${MAX_FILE_BYTES / 1024} KB)` },
          { status: 400 },
        )
      }
      const dryRun = String(form.get('dryRun') ?? 'false') === 'true'
      const isPreview = new URL(req.url).searchParams.get('mode') === 'preview'

      let parsed
      try {
        parsed = await parseSpreadsheetFile({
          name: file.name,
          type: file.type,
          buffer: Buffer.from(await file.arrayBuffer()),
        })
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Could not read the spreadsheet' },
          { status: 400 },
        )
      }

      if (parsed.headers.length === 0) {
        return NextResponse.json({ error: 'Could not detect a header row in the file' }, { status: 400 })
      }

      const missing = missingRequiredColumns(entity, parsed.headers)

      if (isPreview) {
        return NextResponse.json({
          data: {
            headers: parsed.headers,
            rowCount: parsed.rows.length,
            rows: parsed.rows.slice(0, PREVIEW_ROW_COUNT),
            missingRequired: missing,
            kind: parsed.kind,
          },
        })
      }

      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Missing required column: ${missing.join(', ')} — compare with the template` },
          { status: 400 },
        )
      }
      if (parsed.rows.length === 0) {
        return NextResponse.json({ error: 'No data rows found — the file only contains a header' }, { status: 400 })
      }
      if (parsed.rows.length > MAX_ROWS) {
        return NextResponse.json(
          { error: `The file has ${parsed.rows.length} rows — the limit is ${MAX_ROWS} per import` },
          { status: 400 },
        )
      }

      const result = await runImport(entity, parsed.rows, dryRun)
      return NextResponse.json({ data: result })
    }

    // ---- Transport B: JSON rows (kept for API compatibility) --------------
    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const parsed = importSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      )
    }

    const { rows, dryRun } = parsed.data
    const result = await runImport(entity as Entity, rows, dryRun)
    return NextResponse.json({ data: result })
  } catch (err) {
    console.error('POST /api/import failed', err)
    return NextResponse.json({ error: 'Import failed' }, { status: 500 })
  }
}

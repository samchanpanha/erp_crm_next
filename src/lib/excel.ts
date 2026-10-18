/**
 * Server-side Excel (xlsx) toolkit built on ExcelJS.
 * - buildWorkbookBuffer / buildTemplateBuffer: styled, ready-to-open workbooks
 * - xlsxResponse: download response with proper headers
 * - parseSpreadsheetFile: read .xlsx/.xls/.csv uploads into { headers, rows }
 */
import ExcelJS from 'exceljs'
import { parseCsv } from '@/lib/csv'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const ACCENT = 'FFEA580C' // brand orange
const HEADER_TEXT = 'FFFFFFFF'

export interface WorkbookInput {
  sheetName: string
  headers: string[]
  rows: Record<string, unknown>[]
  /** Title row placed above the header row (templates only) */
  title?: string
}

/** Column width from content, clamped to [10, 45] */
function computeWidths(headers: string[], rows: Record<string, unknown>[]): number[] {
  return headers.map((h) => {
    let max = h.length
    for (const r of rows) {
      const v = r[h]
      const len = v === null || v === undefined ? 0 : String(v).length
      if (len > max) max = len
    }
    return Math.min(45, Math.max(10, max + 2))
  })
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.height = 22
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 11 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFD4D4D4' } },
    }
  })
}

/** Build a styled data workbook (frozen header + auto-filter + sized columns). */
export function buildWorkbookBuffer({ sheetName, headers, rows, title }: WorkbookInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'DoliNext ERP & CRM'
  wb.created = new Date()
  const ws = wb.addWorksheet(sheetName.slice(0, 31) || 'Data', {
    views: title ? [{ state: 'frozen', ySplit: 2 }] : [{ state: 'frozen', ySplit: 1 }],
  })

  let headerRowIndex = 1
  if (title) {
    ws.mergeCells(1, 1, 1, Math.max(headers.length, 1))
    const titleCell = ws.getCell(1, 1)
    titleCell.value = title
    titleCell.font = { bold: true, size: 13, color: { argb: ACCENT } }
    titleCell.alignment = { vertical: 'middle' }
    ws.getRow(1).height = 26
    headerRowIndex = 2
  }

  const headerRow = ws.getRow(headerRowIndex)
  headerRow.values = headers
  styleHeaderRow(headerRow)

  for (const r of rows) {
    ws.addRow(headers.map((h) => {
      const v = r[h]
      return v === undefined ? null : v
    }))
  }

  headers.forEach((_, i) => {
    ws.getColumn(i + 1).width = computeWidths(headers, rows)[i]
  })

  if (rows.length > 0) {
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: headers.length },
    }
  }

  return wb.xlsx.writeBuffer().then((ab) => Buffer.from(ab as ArrayBuffer))
}

/** Build the styled import template (headers + sample rows + hint title). */
export function buildTemplateBuffer(sheetName: string, headers: string[], templateRows: Record<string, string>[]): Promise<Buffer> {
  return buildWorkbookBuffer({
    sheetName,
    headers,
    rows: templateRows,
    title: 'Import template — keep row 2 exactly as the header row; delete the sample rows below before importing.',
  })
}

/** Wrap a workbook buffer in a download response. */
export function xlsxResponse(filename: string, buffer: Buffer): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': XLSX_MIME,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

// ---------------------------------------------------------------------------
// Parsing uploaded spreadsheets
// ---------------------------------------------------------------------------

export interface ParsedSheet {
  headers: string[]
  rows: Record<string, string>[]
  kind: 'xlsx' | 'csv'
}

/** Normalize any ExcelJS cell value (string/number/date/bool/formula/rich text) to a string. */
function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if ('richText' in o && Array.isArray(o.richText)) {
      return o.richText.map((rt) => String((rt as { text?: unknown }).text ?? '')).join('')
    }
    if ('result' in o) return cellToString((o as { result: ExcelJS.CellValue }).result)
    if ('text' in o) return String((o as { text: unknown }).text ?? '')
    if ('error' in o) return ''
    if ('hyperlink' in o) return String(o.hyperlink ?? '')
    return ''
  }
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  return String(v)
}

/** Header normalization: trim, replace blank header names with placeholder keys. Values: trim. */
function normalizeSheet(headers: string[], rawRows: unknown[][]): ParsedSheet {
  const cleanHeaders = headers.map((h, i) => {
    const trimmed = String(h ?? '').trim()
    return trimmed !== '' ? trimmed : `__col${i + 1}`
  })
  const rows = rawRows
    .map((cells) => {
      const row: Record<string, string> = {}
      cleanHeaders.forEach((h, idx) => {
        row[h] = String(cells[idx] ?? '').trim()
      })
      return row
    })
    // drop fully-empty rows
    .filter((row) => Object.values(row).some((v) => v !== ''))
  return { headers: cleanHeaders, rows, kind: 'xlsx' }
}

// A1-notation helpers for merge-range detection
function refRow(ref: string): number {
  const m = ref.match(/(\d+)$/)
  return m ? Number(m[1]) : 0
}
function refCol(ref: string): number {
  let col = 0
  for (const ch of ref) {
    if (ch >= 'A' && ch <= 'Z') col = col * 26 + (ch.charCodeAt(0) - 64)
    else break
  }
  return col
}

/** True when rowNo belongs to a horizontal merge spanning 2+ columns (a banner/title row). */
function isMergedBannerRow(ws: ExcelJS.Worksheet, rowNo: number): boolean {
  const merges: unknown = (ws.model as { merges?: string[] } | undefined)?.merges
  if (!Array.isArray(merges)) return false
  return merges.some((m) => {
    const parts = String(m).split(':')
    if (parts.length !== 2) return false
    const [a, b] = parts
    return refRow(a) === rowNo && refRow(b) === rowNo && refCol(b) > refCol(a)
  })
}

/**
 * Parse an uploaded spreadsheet (.xlsx / .xls / .csv) into header + string rows.
 * Detection order: extension → mime → content sniff (xlsx is a ZIP: "PK").
 */
export async function parseSpreadsheetFile(file: {
  name: string
  type: string
  buffer: Buffer
}): Promise<ParsedSheet> {
  const name = file.name.toLowerCase()
  const isZipMagic = file.buffer.length > 4 && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b
  const looksXlsx =
    name.endsWith('.xlsx') || name.endsWith('.xls') ||
    file.type.includes('spreadsheetml') || file.type.includes('ms-excel') ||
    (!name.endsWith('.csv') && isZipMagic)

  if (looksXlsx) {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer)
    const ws = wb.worksheets[0]
    if (!ws) throw new Error('The workbook has no sheets')

    // Header = first row that has any non-empty cell
    let headerRowNo = 0
    let headers: string[] = []
    ws.eachRow((row, rowNumber) => {
      if (headerRowNo !== 0) return
      const values = row.values as ExcelJS.CellValue[]
      const cells = values.slice(1) // index 0 is a placeholder
      const nonEmpty = cells.some((c) => cellToString(c).trim() !== '')
      if (nonEmpty) {
        headerRowNo = rowNumber
        headers = cells.map((c) => cellToString(c).trim())
      }
    })
    if (headerRowNo === 0) throw new Error('Could not find a header row in the spreadsheet')

    // Skip a template/export title row. Titles are merged across the sheet
    // (row.values repeats the master value on covered cells) OR may be a
    // single non-empty cell — in both cases, if the NEXT row looks like a
    // multi-column header, prefer it.
    const singleCellBanner = headers.filter((h) => h !== '').length <= 1
    if ((singleCellBanner || isMergedBannerRow(ws, headerRowNo)) && headerRowNo < ws.rowCount) {
      const next = ws.getRow(headerRowNo + 1).values as ExcelJS.CellValue[]
      const nextCells = next.slice(1).map((c) => cellToString(c).trim())
      if (nextCells.filter((c) => c !== '').length > 1) {
        headerRowNo += 1
        headers = nextCells
      }
    }

    const headersClean = headers.map((h) => String(h ?? '').trim())
    const rawRows: unknown[][] = []
    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowNo) return
      const values = row.values as ExcelJS.CellValue[]
      const cells = values.slice(1)
      rawRows.push(headersClean.map((_, idx) => cellToString(cells[idx] ?? null)))
    })

    return normalizeSheet(headersClean, rawRows)
  }

  // CSV / text fallback
  const text = file.buffer.toString('utf8')
  const parsed = parseCsv(text)
  return { headers: parsed.headers, rows: parsed.rows, kind: 'csv' }
}

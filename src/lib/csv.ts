/**
 * Minimal, dependency-free CSV toolkit shared by import/export features.
 * Handles quoted fields, escaped quotes ("") , comma/semicolon separators,
 * CRLF/LF line endings and a leading BOM.
 */

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
}

/** Parse a CSV string into header + row objects. Auto-detects comma vs semicolon. */
export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, '')
  const firstLineEnd = clean.indexOf('\n')
  const firstLine = firstLineEnd === -1 ? clean : clean.slice(0, firstLineEnd)
  const delimiter = countOccurrences(firstLine, ';') > countOccurrences(firstLine, ',') ? ';' : ','

  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delimiter) {
      record.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++
      record.push(field)
      field = ''
      if (record.some((f) => f.trim() !== '')) records.push(record)
      record = []
    } else {
      field += c
    }
  }
  record.push(field)
  if (record.some((f) => f.trim() !== '')) records.push(record)

  if (records.length === 0) return { headers: [], rows: [] }
  const headers = records[0].map((h) => h.trim())
  const rows = records.slice(1).map((r) => {
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = (r[idx] ?? '').trim()
    })
    return row
  })
  return { headers, rows }
}

function countOccurrences(s: string, needle: string): number {
  let n = 0
  for (const c of s) if (c === needle) n++
  return n
}

/** Convert rows (objects) + column order to CSV text with proper quoting. */
export function stringifyCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v)
    if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [headers.join(',')]
  for (const row of rows) lines.push(headers.map((h) => escape(row[h])).join(','))
  return lines.join('\n')
}

/** Trigger a browser download of a text file (CSV templates, exports…). */
export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\uFEFF' + content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

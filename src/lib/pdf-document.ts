/**
 * Server-side branded PDF generation for printable documents
 * (invoices, proposals, sale orders, supplier invoices, payment receipts).
 *
 * Mirrors the client print engine (src/components/erp/shared/print-document.tsx)
 * so a downloaded PDF looks like the on-screen branded preview: accent color,
 * logo, resolved {{placeholder}} title/header/footer notes, column toggles and
 * the same totals block. Built with pdf-lib (pure JS — no native deps).
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'

import { computeLineTotal } from '@/lib/doc-math'
import {
  DOC_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  STATUS_LABELS,
  resolvePlaceholders,
  type TemplateConfig,
} from '@/lib/template-schema'

export type PdfDocKind = 'INVOICE' | 'PROPOSAL' | 'ORDER' | 'SUPPLIER_INVOICE' | 'RECEIPT'

export interface PdfInvoiceData {
  id?: string
  ref: string
  date: string
  dueDate: string | null
  status: string
  subtotal: number
  discountTotal: number
  vatTotal: number
  total: number
  paidAmount?: number
  notes?: string | null
  thirdParty: {
    name: string
    code: string
    address?: string | null
    zip?: string | null
    city?: string | null
    country?: string | null
    email?: string | null
    phone?: string | null
    taxId?: string | null
  }
  lines: {
    label: string
    description?: string | null
    qty: number
    unitPrice: number
    discountPct: number
    vatRate: number
  }[]
  linkedRef?: string
}

export interface PdfReceiptData {
  id?: string
  paymentRef?: string
  amount: number
  method: string
  date: string
  reference?: string | null
  invoice: { ref: string; total: number; paidAmount: number }
  customer: {
    name: string
    code: string
    address?: string | null
    email?: string | null
    phone?: string | null
    taxId?: string | null
  }
}

export const PDF_KINDS: PdfDocKind[] = ['INVOICE', 'PROPOSAL', 'ORDER', 'SUPPLIER_INVOICE', 'RECEIPT']

export function isPdfDocKind(v: string): v is PdfDocKind {
  return (PDF_KINDS as string[]).includes(v)
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/** CP1252-safe text (StandardFonts cannot encode chars outside WinAnsi). */
function sanitize(input: string): string {
  return input
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013]/g, '\u2013') // en dash — encodable in WinAnsi, keep
    .replace(/[\u2022\u25CF\u00B0\u2713\u2714]/g, '\u00B7')
    .replace(/[\u2212]/g, '-')
    .replace(/[^\u0000-\u00FF\u20AC\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC]/g, '')
}

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex ?? '')
  if (!m) return rgb(0.92, 0.36, 0.05) // fallback accent #ea580c
  const n = parseInt(m[1], 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

function money(v: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 })
    .format(Number.isFinite(v) ? v : 0)
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}

function companyAddressLine(s: Record<string, string>): string {
  const cityLine = [s['company.zip'], s['company.city']].filter(Boolean).join(' ')
  return [s['company.address'], cityLine, s['company.country']].filter(Boolean).join(', ')
}

function customerAddressLine(tp: {
  address?: string | null
  zip?: string | null
  city?: string | null
  country?: string | null
}): string {
  const cityLine = [tp.zip, tp.city].filter(Boolean).join(' ')
  return [tp.address, cityLine, tp.country].filter((p): p is string => !!p && p.length > 0).join(', ')
}

// ---------------------------------------------------------------------------
// Layout engine
// ---------------------------------------------------------------------------

const A4: [number, number] = [595.28, 841.89]
const LETTER: [number, number] = [612, 792]
const MARGIN = 42
const GRAY = rgb(0.45, 0.45, 0.45)
const LIGHT_GRAY = rgb(0.62, 0.62, 0.62)
const BORDER = rgb(0.88, 0.88, 0.88)
const ZEBRA = rgb(0.975, 0.975, 0.975)
const HEAD_BG = rgb(0.955, 0.955, 0.955)
const PANEL_BG = rgb(0.972, 0.972, 0.972)
const DARK = rgb(0.09, 0.09, 0.11)

interface Ctx {
  doc: PDFDocument
  page: PDFPage
  y: number
  pageW: number
  pageH: number
  regular: PDFFont
  bold: PDFFont
  italic: PDFFont
  accent: RGB
  currency: string
  size: { w: number; h: number }
}

function textWidth(font: PDFFont, s: string, size: number): number {
  return font.widthOfTextAtSize(sanitize(s), size)
}

function truncate(font: PDFFont, s: string, size: number, maxW: number): string {
  const clean = sanitize(s)
  if (font.widthOfTextAtSize(clean, size) <= maxW) return clean
  let out = clean
  while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > maxW) out = out.slice(0, -1)
  return `${out}…`
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = []
  for (const rawLine of sanitize(text).split(/\r?\n/)) {
    const words = rawLine.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      out.push('')
      continue
    }
    let line = ''
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w
      if (font.widthOfTextAtSize(candidate, size) <= maxW) {
        line = candidate
      } else {
        if (line) out.push(line)
        line = font.widthOfTextAtSize(w, size) <= maxW ? w : truncate(font, w, size, maxW)
      }
    }
    if (line) out.push(line)
  }
  return out
}

function drawText(ctx: Ctx, s: string, opts: {
  x: number
  y: number
  size: number
  font?: PDFFont
  color?: RGB
  align?: 'left' | 'right'
  maxW?: number
}): void {
  const font = opts.font ?? ctx.regular
  const str = opts.maxW ? truncate(font, s, opts.size, opts.maxW) : sanitize(s)
  const x = opts.align === 'right' ? opts.x - font.widthOfTextAtSize(str, opts.size) : opts.x
  ctx.page.drawText(str, { x, y: opts.y, size: opts.size, font, color: opts.color ?? DARK })
}

function drawWrapped(ctx: Ctx, s: string, opts: {
  x: number
  y: number
  size: number
  font?: PDFFont
  color?: RGB
  maxW: number
  lineH: number
}): number {
  const lines = wrap(s, opts.font ?? ctx.regular, opts.size, opts.maxW)
  let yy = opts.y
  for (const line of lines) {
    ctx.page.drawText(line, { x: opts.x, y: yy, size: opts.size, font: opts.font ?? ctx.regular, color: opts.color ?? DARK })
    yy -= opts.lineH
  }
  return yy + opts.lineH // y of the last drawn line
}

function newPage(ctx: Ctx): void {
  ctx.page = ctx.doc.addPage([ctx.pageW, ctx.pageH])
  ctx.y = ctx.pageH - MARGIN
}

function ensure(ctx: Ctx, needed: number): void {
  if (ctx.y - needed < MARGIN + 30) newPage(ctx)
}

async function embedLogo(ctx: Ctx, dataUrl: string | undefined): Promise<{ img: Awaited<ReturnType<PDFDocument['embedPng']>> | null; w: number; h: number }> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return { img: null, w: 0, h: 0 }
  try {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const bytes = Buffer.from(b64, 'base64')
    const img = dataUrl.includes('image/png') ? await ctx.doc.embedPng(bytes) : await ctx.doc.embedJpg(bytes)
    return { img, w: img.width, h: img.height }
  } catch {
    return { img: null, w: 0, h: 0 }
  }
}

async function drawCompanyBlockAsync(ctx: Ctx, settings: Record<string, string>, showLogo: boolean): Promise<void> {
  const x = MARGIN
  let top = ctx.pageH - MARGIN
  if (showLogo && settings['company.logoDataUrl']) {
    const { img, w, h } = await embedLogo(ctx, settings['company.logoDataUrl'])
    if (img) {
      const maxH = 42
      const maxW = 170
      const scale = Math.min(maxH / h, maxW / w, 1)
      const dh = h * scale
      ctx.page.drawImage(img, { x, y: top - dh, width: w * scale, height: dh })
      top -= dh + 8
    }
  }
  ctx.page.drawText(sanitize(settings['company.name'] ?? ''), {
    x, y: top - 14, size: 14, font: ctx.bold, color: DARK,
  })
  const addr = companyAddressLine(settings)
  let yy = top - 26
  for (const line of wrap(addr, ctx.regular, 8.5, 230)) {
    ctx.page.drawText(line, { x, y: yy, size: 8.5, font: ctx.regular, color: GRAY })
    yy -= 10
  }
  const contact = [settings['company.phone'], settings['company.email'], settings['company.taxId']]
    .filter(Boolean).join(' · ')
  for (const line of wrap(contact, ctx.regular, 8.5, 230)) {
    ctx.page.drawText(line, { x, y: yy, size: 8.5, font: ctx.regular, color: GRAY })
    yy -= 10
  }
  ctx.y = Math.min(ctx.y, yy + 10) - 8
}

function drawTitleAndMeta(ctx: Ctx, title: string, rows: { label: string; value: string }[]): void {
  const right = ctx.pageW - MARGIN
  const boxW = 178
  const visible = rows.filter((r) => r.label && r.value && r.value !== '—')
  const rowH = 14
  const boxH = visible.length * rowH + 10

  // Title (right-aligned, wraps to 2 lines max)
  const titleLines = wrap(title, ctx.bold, 15, ctx.pageW - 2 * MARGIN - boxW - 16).slice(0, 2)
  let ty = ctx.pageH - MARGIN - 15
  for (const line of titleLines) {
    drawText(ctx, line, { x: right, y: ty, size: 15, font: ctx.bold, color: ctx.accent, align: 'right' })
    ty -= 17
  }

  // Meta box
  const boxY = Math.min(ty + 17 - 4, ctx.pageH - MARGIN) - boxH
  ctx.page.drawRectangle({
    x: right - boxW, y: boxY, width: boxW, height: boxH,
    borderColor: BORDER, borderWidth: 0.8, color: rgb(1, 1, 1),
  })
  let ry = boxY + boxH - 7 - 9
  for (const r of visible) {
    ctx.page.drawText(sanitize(r.label), { x: right - boxW + 8, y: ry, size: 8.5, font: ctx.regular, color: GRAY })
    drawText(ctx, r.value, { x: right - boxW + boxW - 8, y: ry, size: 8.5, font: ctx.bold, align: 'right', maxW: boxW - 80 })
    ry -= rowH
  }
  ctx.y = Math.min(ctx.y, boxY - 10)
}

function drawHeaderNote(ctx: Ctx, note: string): void {
  if (!note) return
  const bottom = drawWrapped(ctx, note, {
    x: MARGIN, y: ctx.y - 10, size: 8.5, font: ctx.italic, color: GRAY, maxW: ctx.pageW - 2 * MARGIN, lineH: 10,
  })
  ctx.y = bottom - 6
}

function drawBillTo(ctx: Ctx, tp: PdfInvoiceData['thirdParty'], label: string): void {
  ensure(ctx, 70)
  const lines = [
    customerAddressLine(tp),
    tp.email ?? '',
    tp.phone ?? '',
    tp.taxId ? `Tax ID: ${tp.taxId}` : '',
  ].filter(Boolean)

  const maxW = 260
  const blockH = 14 + 11 + 11 + lines.reduce((s, l) => s + wrap(l, ctx.regular, 8.5, maxW - 12).length * 11, 0) + 12

  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - blockH, width: 2.5, height: blockH, color: ctx.accent })
  let yy = ctx.y - 6
  ctx.page.drawText(sanitize(label.toUpperCase()), { x: MARGIN + 12, y: yy, size: 7.5, font: ctx.bold, color: GRAY })
  yy -= 13
  ctx.page.drawText(truncate(ctx.bold, tp.name, 11, maxW - 12), { x: MARGIN + 12, y: yy, size: 11, font: ctx.bold, color: DARK })
  yy -= 11
  ctx.page.drawText(truncate(ctx.regular, tp.code, 8.5, maxW - 12), { x: MARGIN + 12, y: yy, size: 8.5, font: ctx.regular, color: GRAY })
  yy -= 11
  for (const l of lines) {
    for (const piece of wrap(l, ctx.regular, 8.5, maxW - 12)) {
      ctx.page.drawText(piece, { x: MARGIN + 12, y: yy, size: 8.5, font: ctx.regular, color: rgb(0.35, 0.35, 0.35) })
      yy -= 11
    }
  }
  ctx.y = yy - 6
}

interface TableCol { label: string; width: number; align: 'left' | 'right' }

function buildColumns(config: TemplateConfig, contentW: number): TableCol[] {
  const f = config.fields
  const cols: TableCol[] = [{ label: '#', width: 20, align: 'left' }]
  if (f.showDescription) cols.push({ label: 'Description', width: 0, align: 'left' }) // flex
  if (f.showQty) cols.push({ label: 'Qty', width: 42, align: 'right' })
  if (f.showUnitPrice) cols.push({ label: 'Unit price', width: 64, align: 'right' })
  if (f.showDiscount) cols.push({ label: 'Disc %', width: 42, align: 'right' })
  if (f.showVat) cols.push({ label: 'VAT %', width: 40, align: 'right' })
  cols.push({ label: 'Amount', width: 66, align: 'right' })
  const fixed = cols.reduce((s, c) => s + c.width, 0)
  const desc = cols.find((c) => c.label === 'Description')
  if (desc) desc.width = Math.max(120, contentW - fixed)
  return cols
}

function drawTableHeader(ctx: Ctx, cols: TableCol[], xs: number[]): void {
  const h = 18
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - h, width: ctx.pageW - 2 * MARGIN, height: h, color: HEAD_BG, borderColor: BORDER, borderWidth: 0.6 })
  cols.forEach((c, i) => {
    const cx = c.align === 'right' ? xs[i] + c.width - 6 : xs[i] + 6
    drawText(ctx, c.label, { x: cx, y: ctx.y - h + 5.5, size: 8.5, font: ctx.bold, color: DARK, align: c.align === 'right' ? 'right' : 'left' })
  })
  ctx.y -= h
}

function drawLineRows(
  ctx: Ctx,
  data: PdfInvoiceData,
  cols: TableCol[],
  xs: number[],
  contentW: number,
): void {
  const continuationTitle = `${DOC_TYPE_LABELS[docKindOf(ctx)] ?? 'Document'} — continued`
  const drawContinuation = () => {
    drawText(ctx, continuationTitle, {
      x: MARGIN, y: ctx.y - 12, size: 9, font: ctx.italic, color: GRAY,
    })
    ctx.y -= 18
    drawTableHeader(ctx, cols, xs)
  }

  if (data.lines.length === 0) {
    ensure(ctx, 26)
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 22, width: contentW, height: 22, borderColor: BORDER, borderWidth: 0.6 })
    drawText(ctx, 'No line items — totals entered directly', {
      x: MARGIN + contentW / 2, y: ctx.y - 14, size: 8.5, font: ctx.italic, color: LIGHT_GRAY, align: 'right',
    })
    ctx.y -= 22
    return
  }

  const descColW = (cols.find((c) => c.label === 'Description')?.width ?? 200) - 12

  data.lines.forEach((l, i) => {
    const descLines = l.description ? wrap(l.description, ctx.regular, 8, descColW).slice(0, 2) : []
    const rowH = 8 + 9 + descLines.length * 9 + 8

    if (ctx.y - rowH < MARGIN + 30) {
      newPage(ctx)
      drawContinuation()
    }

    if (i % 2 === 1) {
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - rowH, width: contentW, height: rowH, color: ZEBRA })
    }

    cols.forEach((c, ci) => {
      const cellX = c.align === 'right' ? xs[ci] + c.width - 6 : xs[ci] + 6
      const ty = ctx.y - rowH + 8
      if (c.label === '#') {
        drawText(ctx, String(i + 1), { x: cellX, y: ty, size: 8.5, color: GRAY, maxW: c.width - 10 })
      } else if (c.label === 'Description') {
        drawText(ctx, l.label, { x: cellX, y: ty, size: 9, font: ctx.bold, maxW: descColW })
        let dy = ty - 9
        for (const piece of descLines) {
          ctx.page.drawText(piece, { x: cellX, y: dy, size: 8, font: ctx.regular, color: GRAY })
          dy -= 9
        }
      } else if (c.label === 'Qty') {
        drawText(ctx, formatQty(l.qty), { x: cellX, y: ty, size: 8.5, align: 'right', maxW: c.width - 10 })
      } else if (c.label === 'Unit price') {
        drawText(ctx, money(l.unitPrice, ctx.currency), { x: cellX, y: ty, size: 8.5, align: 'right', maxW: c.width - 10 })
      } else if (c.label === 'Disc %') {
        drawText(ctx, String(l.discountPct ?? 0), { x: cellX, y: ty, size: 8.5, align: 'right', maxW: c.width - 10 })
      } else if (c.label === 'VAT %') {
        drawText(ctx, `${l.vatRate ?? 0}%`, { x: cellX, y: ty, size: 8.5, align: 'right', maxW: c.width - 10 })
      } else if (c.label === 'Amount') {
        drawText(ctx, money(computeLineTotal(l), ctx.currency), { x: cellX, y: ty, size: 8.5, font: ctx.bold, align: 'right', maxW: c.width - 10 })
      }
    })

    // row borders
    ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y - rowH }, end: { x: MARGIN + contentW, y: ctx.y - rowH }, color: BORDER, thickness: 0.6 })
    ctx.y -= rowH
  })
  ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: MARGIN + contentW, y: ctx.y }, color: BORDER, thickness: 0.6 })
  ctx.y -= 4
}

// docKind marker so continuation header can name the document
const ctxKind = new WeakMap<object, PdfDocKind>()
function docKindOf(ctx: Ctx): PdfDocKind {
  return ctxKind.get(ctx.doc) ?? 'INVOICE'
}

function formatQty(q: number): string {
  return Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100)
}

function drawTotals(ctx: Ctx, data: PdfInvoiceData, config: TemplateConfig): void {
  const f = config.fields
  const rows: { label: string; value: string; bold?: boolean; big?: boolean; color?: RGB }[] = [
    { label: 'Subtotal', value: money(data.subtotal, ctx.currency) },
  ]
  if (f.showDiscount && data.discountTotal > 0) {
    rows.push({ label: 'Discount', value: `-${money(data.discountTotal, ctx.currency)}` })
  }
  if (f.showVat) rows.push({ label: 'VAT total', value: money(data.vatTotal, ctx.currency) })
  rows.push({ label: 'TOTAL', value: money(data.total, ctx.currency), bold: true, big: true, color: ctx.accent })
  if (data.paidAmount !== undefined) {
    rows.push({ label: 'Amount paid', value: money(data.paidAmount, ctx.currency) })
    rows.push({ label: 'Amount due', value: money(Math.max(0, data.total - data.paidAmount), ctx.currency), bold: true })
  }

  const blockW = 210
  const blockH = rows.reduce((s, r) => s + (r.big ? 26 : 17), 8)
  ensure(ctx, blockH + 10)

  const x1 = ctx.pageW - MARGIN - blockW
  let y = ctx.y - 4
  for (const r of rows) {
    if (r.big) {
      y -= 26
      ctx.page.drawLine({ start: { x: x1, y: y + 20 }, end: { x: x1 + blockW, y: y + 20 }, color: LIGHT_GRAY, thickness: 0.8 })
      drawText(ctx, r.label, { x: x1, y: y + 4, size: 10, font: ctx.bold })
      drawText(ctx, r.value, { x: x1 + blockW, y: y + 1, size: 14, font: ctx.bold, color: r.color, align: 'right' })
    } else {
      y -= 17
      drawText(ctx, r.label, { x: x1, y: y + 4, size: 9, color: GRAY })
      drawText(ctx, r.value, { x: x1 + blockW, y: y + 4, size: 9, font: r.bold ? ctx.bold : ctx.regular, align: 'right' })
    }
  }
  ctx.y = y - 8
}

function drawNotes(ctx: Ctx, notes: string | null | undefined, accent: RGB): void {
  if (!notes) return
  ensure(ctx, 40)
  const lines = wrap(notes, ctx.italic, 8.5, ctx.pageW - 2 * MARGIN - 20)
  const h = lines.length * 10 + 10
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - h, width: 2, height: h, color: accent })
  let yy = ctx.y - 8
  for (const line of lines) {
    ctx.page.drawText(line, { x: MARGIN + 12, y: yy, size: 8.5, font: ctx.italic, color: rgb(0.3, 0.3, 0.3) })
    yy -= 10
  }
  ctx.y = ctx.y - h - 6
}

async function drawFooterBlock(ctx: Ctx, config: TemplateConfig, settings: Record<string, string>, footerNote: string): Promise<void> {
  const f = config.fields
  const contentW = ctx.pageW - 2 * MARGIN

  if (footerNote) {
    drawWrapped(ctx, footerNote, {
      x: MARGIN, y: ctx.y - 10, size: 8.5, font: ctx.italic, color: GRAY, maxW: contentW, lineH: 10,
    })
    ctx.y -= 16
  }

  const need = (f.showBankDetails && settings['company.bankDetails'] ? 56 : 20) + (f.showSignature ? 56 : 0)
  ensure(ctx, need)

  let leftY = ctx.y - 8
  if (f.showPaymentTerms) {
    drawText(ctx, `Payment terms: ${settings['sales.defaultPaymentTerms'] || '—'}`, {
      x: MARGIN, y: leftY, size: 8.5, color: rgb(0.35, 0.35, 0.35),
    })
    leftY -= 12
  }
  if (f.showBankDetails && settings['company.bankDetails']) {
    const boxW = Math.min(300, contentW)
    const boxLines = wrap(settings['company.bankDetails'], ctx.regular, 8, boxW - 16)
    const boxH = 18 + boxLines.length * 10
    ctx.page.drawRectangle({ x: MARGIN, y: leftY - boxH, width: boxW, height: boxH, color: PANEL_BG, borderColor: BORDER, borderWidth: 0.7 })
    ctx.page.drawText('BANK DETAILS', { x: MARGIN + 8, y: leftY - 12, size: 6.5, font: ctx.bold, color: LIGHT_GRAY })
    let by = leftY - 24
    for (const line of boxLines) {
      ctx.page.drawText(line, { x: MARGIN + 8, y: by, size: 8, font: ctx.regular, color: rgb(0.35, 0.35, 0.35) })
      by -= 10
    }
    leftY -= boxH + 6
  }
  if (f.showSignature) {
    const sigW = 150
    const sigX = ctx.pageW - MARGIN - sigW
    const sigY = Math.min(leftY - 26, ctx.y - 40)
    ctx.page.drawLine({ start: { x: sigX, y: sigY }, end: { x: sigX + sigW, y: sigY }, color: LIGHT_GRAY, thickness: 0.8 })
    ctx.page.drawText('AUTHORISED SIGNATURE', { x: sigX, y: sigY - 9, size: 6.5, font: ctx.regular, color: LIGHT_GRAY })
  }
  ctx.y = Math.min(leftY, ctx.y - 20) - 10
}

function drawPageFooters(ctx: Ctx, companyName: string): void {
  const pages = ctx.doc.getPages()
  pages.forEach((p, i) => {
    const label = sanitize(`${companyName} · generated by DoliNext`)
    const pageLabel = `${i + 1} / ${pages.length}`
    p.drawText(label, {
      x: MARGIN, y: MARGIN - 14, size: 7.5, font: ctx.regular, color: LIGHT_GRAY,
    })
    p.drawText(pageLabel, {
      x: p.getWidth() - MARGIN - ctx.regular.widthOfTextAtSize(pageLabel, 7.5),
      y: MARGIN - 14, size: 7.5, font: ctx.regular, color: LIGHT_GRAY,
    })
  })
}

// ---------------------------------------------------------------------------
// Placeholder value builders (mirror the client print engine)
// ---------------------------------------------------------------------------

function buildInvoiceValues(d: PdfInvoiceData, s: Record<string, string>, docType: string, currency: string): Record<string, string> {
  const paid = d.paidAmount ?? 0
  const due = Math.max(0, Math.round((d.total - paid) * 100) / 100)
  return {
    'company.name': s['company.name'] ?? '',
    'company.legalName': s['company.legalName'] ?? '',
    'company.address': companyAddressLine(s),
    'company.phone': s['company.phone'] ?? '',
    'company.email': s['company.email'] ?? '',
    'company.website': s['company.website'] ?? '',
    'company.taxId': s['company.taxId'] ?? '',
    'company.bankDetails': s['company.bankDetails'] ?? '',
    'doc.type': docType,
    'doc.ref': d.ref,
    'doc.date': fmtDate(d.date),
    'doc.dueDate': d.dueDate ? fmtDate(d.dueDate) : '',
    'doc.status': STATUS_LABELS[d.status] ?? d.status,
    'doc.subtotal': money(d.subtotal, currency),
    'doc.discountTotal': money(d.discountTotal, currency),
    'doc.vatTotal': money(d.vatTotal, currency),
    'doc.total': money(d.total, currency),
    'doc.paidAmount': money(paid, currency),
    'doc.dueAmount': money(due, currency),
    'doc.notes': d.notes ?? '',
    'customer.name': d.thirdParty.name,
    'customer.code': d.thirdParty.code,
    'customer.address': customerAddressLine(d.thirdParty),
    'customer.email': d.thirdParty.email ?? '',
    'customer.phone': d.thirdParty.phone ?? '',
    'customer.taxId': d.thirdParty.taxId ?? '',
  }
}

function buildReceiptValues(d: PdfReceiptData, s: Record<string, string>, currency: string): Record<string, string> {
  const remaining = Math.max(0, Math.round((d.invoice.total - d.invoice.paidAmount) * 100) / 100)
  return {
    'company.name': s['company.name'] ?? '',
    'company.legalName': s['company.legalName'] ?? '',
    'company.address': companyAddressLine(s),
    'company.phone': s['company.phone'] ?? '',
    'company.email': s['company.email'] ?? '',
    'company.website': s['company.website'] ?? '',
    'company.taxId': s['company.taxId'] ?? '',
    'company.bankDetails': s['company.bankDetails'] ?? '',
    'doc.type': DOC_TYPE_LABELS['RECEIPT'] ?? 'Payment receipt',
    'doc.ref': d.invoice.ref,
    'doc.date': fmtDate(d.date),
    'doc.dueDate': '',
    'doc.status': remaining <= 0.001 ? (STATUS_LABELS.PAID ?? 'Paid') : (STATUS_LABELS.PARTIAL ?? 'Partially paid'),
    'doc.total': money(d.invoice.total, currency),
    'doc.paidAmount': money(d.invoice.paidAmount, currency),
    'doc.dueAmount': money(remaining, currency),
    'customer.name': d.customer.name,
    'customer.code': d.customer.code,
    'customer.address': customerAddressLine(d.customer),
    'customer.email': d.customer.email ?? '',
    'customer.phone': d.customer.phone ?? '',
    'customer.taxId': d.customer.taxId ?? '',
    'payment.amount': money(d.amount, currency),
    'payment.method': PAYMENT_METHOD_LABELS[d.method] ?? d.method,
    'payment.date': fmtDate(d.date),
    'payment.reference': d.reference ?? d.paymentRef ?? '',
    'payment.invoiceRef': d.invoice.ref,
    'payment.remaining': money(remaining, currency),
  }
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

async function buildLineDocPdf(
  kind: PdfDocKind,
  data: PdfInvoiceData,
  config: TemplateConfig,
  settings: Record<string, string>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const size = config.paperSize === 'LETTER' ? LETTER : A4
  const currency = settings['app.currency'] || 'USD'
  const ctx: Ctx = {
    doc,
    page: doc.addPage(size),
    y: size[1] - MARGIN,
    pageW: size[0],
    pageH: size[1],
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    accent: hexToRgb(config.accentColor),
    currency,
    size: { w: size[0], h: size[1] },
  }
  ctxKind.set(doc, kind)

  const docType = DOC_TYPE_LABELS[kind] ?? kind
  const values = buildInvoiceValues(data, settings, docType, currency)
  const title = resolvePlaceholders(config.titlePattern, values)
  const headerNote = config.headerNote ? resolvePlaceholders(config.headerNote, values) : ''
  const footerNote = config.footerNote ? resolvePlaceholders(config.footerNote, values) : ''

  await drawCompanyBlockAsync(ctx, settings, config.fields.showLogo)
  drawTitleAndMeta(ctx, title, [
    { label: 'Status', value: STATUS_LABELS[data.status] ?? data.status },
    { label: 'Date', value: fmtDate(data.date) },
    { label: data.dueDate ? ({ INVOICE: 'Due date', SUPPLIER_INVOICE: 'Due date', PROPOSAL: 'Valid until', ORDER: 'Delivery date' }[kind] ?? 'Due date') : '', value: data.dueDate ? fmtDate(data.dueDate) : '' },
    { label: 'Linked doc', value: data.linkedRef ?? '' },
    { label: 'Reference', value: data.linkedRef ? data.ref : '' },
  ])
  drawHeaderNote(ctx, headerNote)
  drawBillTo(ctx, data.thirdParty, kind === 'SUPPLIER_INVOICE' ? 'Supplier' : 'Bill to')

  const contentW = ctx.pageW - 2 * MARGIN
  const cols = buildColumns(config, contentW)
  const xs: number[] = []
  let acc = MARGIN
  for (const c of cols) {
    xs.push(acc)
    acc += c.width
  }
  drawTableHeader(ctx, cols, xs)
  drawLineRows(ctx, data, cols, xs, contentW)
  drawTotals(ctx, data, config)
  if (config.fields.showNotes) drawNotes(ctx, data.notes, ctx.accent)
  await drawFooterBlock(ctx, config, settings, footerNote)
  drawPageFooters(ctx, settings['company.name'] ?? '')

  return doc.save()
}

async function buildReceiptPdf(
  data: PdfReceiptData,
  config: TemplateConfig,
  settings: Record<string, string>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const size = config.paperSize === 'LETTER' ? LETTER : A4
  const currency = settings['app.currency'] || 'USD'
  const ctx: Ctx = {
    doc,
    page: doc.addPage(size),
    y: size[1] - MARGIN,
    pageW: size[0],
    pageH: size[1],
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    accent: hexToRgb(config.accentColor),
    currency,
    size: { w: size[0], h: size[1] },
  }
  ctxKind.set(doc, 'RECEIPT')

  const values = buildReceiptValues(data, settings, currency)
  const title = resolvePlaceholders(config.titlePattern, values)
  const headerNote = config.headerNote ? resolvePlaceholders(config.headerNote, values) : ''
  const footerNote = config.footerNote ? resolvePlaceholders(config.footerNote, values) : ''
  const remaining = Math.max(0, Math.round((data.invoice.total - data.invoice.paidAmount) * 100) / 100)
  const fullyPaid = remaining <= 0.001

  await drawCompanyBlockAsync(ctx, settings, config.fields.showLogo)
  drawTitleAndMeta(ctx, title, [
    { label: 'Invoice', value: data.invoice.ref },
    { label: 'Invoice total', value: money(data.invoice.total, currency) },
    { label: 'Status', value: fullyPaid ? (STATUS_LABELS.PAID ?? 'Paid') : (STATUS_LABELS.PARTIAL ?? 'Partially paid') },
  ])
  drawHeaderNote(ctx, headerNote)
  drawBillTo(ctx, { ...data.customer, zip: null, city: null, country: null }, 'Bill to')

  // Amount received panel
  const contentW = ctx.pageW - 2 * MARGIN
  const panelH = 150
  ensure(ctx, panelH + 10)
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - panelH, width: contentW, height: panelH, borderColor: BORDER, borderWidth: 0.9, color: rgb(1, 1, 1) })

  const cx = ctx.pageW / 2
  ctx.page.drawText('AMOUNT RECEIVED', { x: cx - ctx.bold.widthOfTextAtSize('AMOUNT RECEIVED', 7.5) / 2, y: ctx.y - 22, size: 7.5, font: ctx.bold, color: GRAY })
  const amountStr = sanitize(money(data.amount, currency))
  ctx.page.drawText(amountStr, {
    x: cx - ctx.bold.widthOfTextAtSize(amountStr, 22) / 2, y: ctx.y - 48, size: 22, font: ctx.bold, color: ctx.accent,
  })
  const fromStr = sanitize(`Received from ${data.customer.name} (${data.customer.code})`)
  ctx.page.drawText(fromStr, { x: cx - ctx.regular.widthOfTextAtSize(fromStr, 9) / 2, y: ctx.y - 66, size: 9, font: ctx.regular, color: DARK })

  const detailRows = [
    { label: 'Payment method', value: PAYMENT_METHOD_LABELS[data.method] ?? data.method },
    { label: 'Payment date', value: fmtDate(data.date) },
    { label: 'Reference', value: data.reference ?? data.paymentRef ?? '—' },
    { label: 'For invoice', value: data.invoice.ref },
  ]
  let ry = ctx.y - 88
  for (const r of detailRows) {
    ctx.page.drawText(sanitize(r.label), { x: cx - 90, y: ry, size: 8.5, font: ctx.regular, color: GRAY })
    drawText(ctx, r.value, { x: cx + 90, y: ry, size: 8.5, font: ctx.bold, align: 'right', maxW: 150 })
    ry -= 13
  }
  const remStr = sanitize(`Remaining balance on ${data.invoice.ref}: ${money(remaining, currency)}`)
  ctx.page.drawText(remStr, { x: cx - ctx.regular.widthOfTextAtSize(remStr, 9) / 2, y: ry - 2, size: 9, font: ctx.bold, color: fullyPaid ? rgb(0.06, 0.5, 0.29) : rgb(0.72, 0.45, 0.05) })
  ctx.y -= panelH + 10

  await drawFooterBlock(ctx, config, settings, footerNote)
  drawPageFooters(ctx, settings['company.name'] ?? '')

  return doc.save()
}

export async function buildDocumentPdf(opts: {
  kind: PdfDocKind
  data: PdfInvoiceData | PdfReceiptData
  config: TemplateConfig
  settings: Record<string, string>
}): Promise<Uint8Array> {
  if (opts.kind === 'RECEIPT' && 'invoice' in opts.data) {
    return buildReceiptPdf(opts.data, opts.config, opts.settings)
  }
  if (!('lines' in opts.data)) {
    throw new Error('Invalid document payload for PDF generation')
  }
  return buildLineDocPdf(opts.kind, opts.data, opts.config, opts.settings)
}

/**
 * Shared document math for quotes/orders/invoices line items.
 * Used by both API routes and UI so totals are always consistent.
 */
export interface DocLineInput {
  qty: number
  unitPrice: number
  discountPct?: number | null
  vatRate?: number | null
}

export const round2 = (n: number) => Math.round(n * 100) / 100

export function computeLineTotal(line: DocLineInput): number {
  const discount = line.discountPct ?? 0
  return round2(line.qty * line.unitPrice * (1 - discount / 100))
}

export function computeLineVat(line: DocLineInput): number {
  const vat = line.vatRate ?? 20
  return round2(computeLineTotal(line) * (vat / 100))
}

export interface DocTotals {
  subtotal: number
  discountTotal: number
  vatTotal: number
  total: number
}

export function computeTotals(lines: DocLineInput[]): DocTotals {
  const subtotal = lines.reduce((s, l) => s + computeLineTotal(l), 0)
  const discountTotal = lines.reduce(
    (s, l) => s + l.qty * l.unitPrice * ((l.discountPct ?? 0) / 100),
    0
  )
  const vatTotal = lines.reduce((s, l) => s + computeLineVat(l), 0)
  return {
    subtotal: round2(subtotal),
    discountTotal: round2(discountTotal),
    vatTotal: round2(vatTotal),
    total: round2(subtotal + vatTotal),
  }
}

/** Recompute paid status for invoices after a payment */
export function invoiceStatusFromPaid(
  total: number,
  paidAmount: number
): 'UNPAID' | 'PARTIAL' | 'PAID' {
  if (paidAmount >= total - 0.001) return 'PAID'
  if (paidAmount > 0) return 'PARTIAL'
  return 'UNPAID'
}

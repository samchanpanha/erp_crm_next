import { db } from '@/lib/db'

/**
 * Generate a Dolibarr-style document reference, e.g. "PR2606-0001".
 * Uses an atomic upsert+increment on the Sequence table.
 * Counters are per-tenant: the Sequence row key is "<tenantId>:<prefix>".
 */
export async function nextRef(tenantId: string, prefix: string): Promise<string> {
  const key = `${tenantId}:${prefix}`
  const seq = await db.sequence.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  })
  const now = new Date()
  const yy = String(now.getFullYear()).slice(2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return `${prefix}${yy}${mm}-${String(seq.value).padStart(4, '0')}`
}

/** Standard prefixes used across the app */
export const REF_PREFIX = {
  thirdParty: 'CU',
  proposal: 'PR',
  saleOrder: 'SO',
  invoice: 'IN',
  purchaseOrder: 'PO',
  supplierInvoice: 'SI',
  contract: 'CT',
  project: 'PJ',
  task: 'TS',
  ticket: 'TK',
  expenseReport: 'ER',
  product: 'PD',
} as const

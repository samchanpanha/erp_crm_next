'use client'

/**
 * Printable document engine (V2) — renders branded, template-driven previews of
 * invoices / proposals / orders / supplier invoices / payment receipts inside a
 * Dialog and prints them via the browser "Save as PDF" flow.
 *
 * Print isolation relies on the @media print rules in globals.css keyed on
 * `body.printing-doc` + `.print-area` (visibility isolation). Because the
 * preview lives inside a fixed/transformed Radix Dialog, `usePrintNow` also
 * injects a temporary <style id="print-page-size"> that carries the @page rule
 * plus dialog-flattening rules so the .print-area lands at the top-left of the
 * printed page.
 */
import { useCallback, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Printer, X } from 'lucide-react'

import { get } from '../lib/api'
import { computeLineTotal } from '@/lib/doc-math'
import {
  DEFAULT_TEMPLATE_CONFIG,
  DOC_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  STATUS_LABELS,
  resolvePlaceholders,
  templateConfigSchema,
  type TemplateConfig,
} from '@/lib/template-schema'
import { useSettingsStore, type SettingsMap } from '@/lib/settings-store'
import { formatDate, formatMoney } from './format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// ---------------------------------------------------------------------------
// Public data shapes
// ---------------------------------------------------------------------------
export interface InvoicePrintData {
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

export interface ReceiptPrintData {
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

export type DocKind = 'INVOICE' | 'PROPOSAL' | 'ORDER' | 'SUPPLIER_INVOICE' | 'RECEIPT'

// ---------------------------------------------------------------------------
// Template loading (default template per kind, resilient fallbacks)
// ---------------------------------------------------------------------------
interface TemplateRow {
  id: string
  name: string
  type: string
  isDefault: boolean
  config: string
}

function parseConfig(raw: string | undefined): TemplateConfig {
  if (!raw) return DEFAULT_TEMPLATE_CONFIG
  try {
    const parsed = templateConfigSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : DEFAULT_TEMPLATE_CONFIG
  } catch {
    return DEFAULT_TEMPLATE_CONFIG
  }
}

function useDocTemplate(kind: DocKind, enabled: boolean) {
  return useQuery({
    queryKey: ['doc-template', kind],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<{ name: string; config: TemplateConfig }> => {
      try {
        const rows = await get<TemplateRow[]>(`/api/doc-templates?type=${kind}`)
        const row = rows.find((r) => r.isDefault) ?? rows[0]
        if (!row) return { name: 'Default template', config: DEFAULT_TEMPLATE_CONFIG }
        return { name: row.name, config: parseConfig(row.config) }
      } catch {
        return { name: 'Default template', config: DEFAULT_TEMPLATE_CONFIG }
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Print plumbing — body.printing-doc + @page size style + window.print()
// ---------------------------------------------------------------------------
export function usePrintNow(paperSize: 'A4' | 'LETTER' = 'A4') {
  return useCallback(() => {
    document.body.classList.add('printing-doc')

    // Temporary @page + dialog-flattening rules (removed again on cleanup).
    document.getElementById('print-page-size')?.remove()
    const style = document.createElement('style')
    style.id = 'print-page-size'
    style.textContent = [
      `@page { size: ${paperSize === 'LETTER' ? 'letter' : 'A4'}; margin: 12mm }`,
      // The preview is rendered inside a fixed + transformed Radix dialog —
      // flatten it so .print-area's absolute positioning resolves to the page.
      'body.printing-doc [data-slot="dialog-content"] {',
      '  position: static !important; transform: none !important; inset: auto !important;',
      '  width: auto !important; max-width: none !important; margin: 0 !important; padding: 0 !important;',
      '  border: 0 !important; box-shadow: none !important; background: white !important;',
      '  overflow: visible !important; display: block !important;',
      '}',
      'body.printing-doc [data-slot="dialog-overlay"] { display: none !important; }',
      'body.printing-doc .print-area { max-height: none !important; width: auto !important; max-width: 100% !important; box-sizing: border-box !important; }',
    ].join('\n')
    document.head.appendChild(style)

    const cleanup = () => {
      document.body.classList.remove('printing-doc')
      document.getElementById('print-page-size')?.remove()
    }
    window.addEventListener('afterprint', cleanup, { once: true })
    window.print()
    // Safety net in case afterprint never fires (e.g. print dialog dismissed oddly)
    window.setTimeout(cleanup, 2000)
  }, [paperSize])
}

// ---------------------------------------------------------------------------
// Value helpers for placeholder resolution
// ---------------------------------------------------------------------------
function companyAddressLine(s: SettingsMap): string {
  const cityLine = [s['company.zip'], s['company.city']].filter(Boolean).join(' ')
  return [s['company.address'], cityLine, s['company.country']]
    .filter((p): p is string => !!p)
    .join(', ')
}

function customerAddressLine(tp: {
  address?: string | null
  zip?: string | null
  city?: string | null
  country?: string | null
}): string {
  const cityLine = [tp.zip, tp.city].filter(Boolean).join(' ')
  return [tp.address, cityLine, tp.country]
    .filter((p): p is string => !!p && p.length > 0)
    .join(', ')
}

// ---------------------------------------------------------------------------
// Shared document chrome
// ---------------------------------------------------------------------------
const printAreaStyle = (paperSize: 'A4' | 'LETTER'): React.CSSProperties => ({
  maxWidth: paperSize === 'LETTER' ? 816 : 794,
  padding: 48,
  fontSize: 13,
  colorAdjust: 'exact',
  WebkitPrintColorAdjust: 'exact',
})

function CompanyBlock({ config, settings }: { config: TemplateConfig; settings: SettingsMap }) {
  const logo = settings['company.logoDataUrl']
  return (
    <div className="min-w-0">
      {config.fields.showLogo && logo ? (
        <img src={logo} alt={`${settings['company.name']} logo`} className="mb-2 h-14 object-contain" />
      ) : null}
      <p className="text-lg font-bold leading-tight">{settings['company.name']}</p>
      <p className="mt-0.5 text-[12px] text-neutral-500">{companyAddressLine(settings)}</p>
      <p className="text-[12px] text-neutral-500">
        {[settings['company.phone'], settings['company.email'], settings['company.taxId']]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  )
}

function MetaBox({ rows }: { rows: { label: string; value: string }[] }) {
  const visible = rows.filter((r) => r.label && r.value && r.value !== '—')
  if (visible.length === 0) return null
  return (
    <div className="min-w-52 rounded-md border border-neutral-300 px-4 py-3 text-[12px]">
      {visible.map((r) => (
        <div key={r.label} className="flex justify-between gap-6 py-0.5">
          <span className="text-neutral-500">{r.label}</span>
          <span className="font-medium">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

function BillToCard({
  tp,
  accentColor,
  label = 'Bill to',
}: {
  tp: InvoicePrintData['thirdParty'] | ReceiptPrintData['customer']
  accentColor: string
  label?: string
}) {
  const lines = [
    customerAddressLine(tp),
    tp.email ?? '',
    tp.phone ?? '',
    tp.taxId ? `Tax ID: ${tp.taxId}` : '',
  ].filter(Boolean)
  return (
    <div className="my-6" style={{ borderLeft: `3px solid ${accentColor}` }}>
      <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">{label}</p>
      <p className="px-3 pt-0.5 font-bold">{tp.name}</p>
      <p className="px-3 text-[11px] text-neutral-500">{tp.code}</p>
      {lines.map((l) => (
        <p key={l} className="px-3 text-[12px] text-neutral-600">
          {l}
        </p>
      ))}
    </div>
  )
}

function PaidStamp({ accentColor }: { accentColor: string }) {
  return (
    <div
      aria-hidden="true"
      className="absolute top-6 right-6 rotate-[-12deg] rounded-md border-2 px-5 py-1.5 text-2xl font-black uppercase tracking-widest opacity-60"
      style={{ borderColor: accentColor, color: accentColor }}
    >
      Paid
    </div>
  )
}

// ---------------------------------------------------------------------------
// Footer (payment terms / bank details / signature / bottom strip)
// ---------------------------------------------------------------------------
function DocFooter({ config, settings, footerNote }: { config: TemplateConfig; settings: SettingsMap; footerNote: string }) {
  const f = config.fields
  return (
    <div className="mt-10">
      {footerNote ? <p className="mb-3 text-[12px] italic text-neutral-500">{footerNote}</p> : null}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0 space-y-3">
          {f.showPaymentTerms && (
            <p className="text-[12px] text-neutral-600">
              Payment terms: {settings['sales.defaultPaymentTerms'] || '—'}
            </p>
          )}
          {f.showBankDetails && settings['company.bankDetails'] ? (
            <div className="max-w-md rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-[11.5px] text-neutral-600">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                Bank details
              </p>
              <p className="whitespace-pre-wrap">{settings['company.bankDetails']}</p>
            </div>
          ) : null}
        </div>
        {f.showSignature && (
          <div className="w-56">
            <div className="h-16 border-t border-neutral-400" />
            <p className="mt-1 text-[10px] uppercase tracking-widest text-neutral-400">Authorised signature</p>
          </div>
        )}
      </div>
      <div className="mt-8 border-t border-neutral-200 pt-2 text-center text-[10.5px] text-neutral-400">
        {settings['company.name']} · generated by DoliNext
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Placeholder value maps
// ---------------------------------------------------------------------------
function buildInvoiceValues(d: InvoicePrintData, s: SettingsMap, docType: string): Record<string, string> {
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
    'doc.date': formatDate(d.date),
    'doc.dueDate': d.dueDate ? formatDate(d.dueDate) : '',
    'doc.status': STATUS_LABELS[d.status] ?? d.status,
    'doc.subtotal': formatMoney(d.subtotal),
    'doc.discountTotal': formatMoney(d.discountTotal),
    'doc.vatTotal': formatMoney(d.vatTotal),
    'doc.total': formatMoney(d.total),
    'doc.paidAmount': formatMoney(paid),
    'doc.dueAmount': formatMoney(due),
    'doc.notes': d.notes ?? '',
    'customer.name': d.thirdParty.name,
    'customer.code': d.thirdParty.code,
    'customer.address': customerAddressLine(d.thirdParty),
    'customer.email': d.thirdParty.email ?? '',
    'customer.phone': d.thirdParty.phone ?? '',
    'customer.taxId': d.thirdParty.taxId ?? '',
  }
}

function buildReceiptValues(d: ReceiptPrintData, s: SettingsMap): Record<string, string> {
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
    'doc.date': formatDate(d.date),
    'doc.dueDate': '',
    'doc.status':
      remaining <= 0.001 ? (STATUS_LABELS.PAID ?? 'Paid') : (STATUS_LABELS.PARTIAL ?? 'Partially paid'),
    'doc.total': formatMoney(d.invoice.total),
    'doc.paidAmount': formatMoney(d.invoice.paidAmount),
    'doc.dueAmount': formatMoney(remaining),
    'customer.name': d.customer.name,
    'customer.code': d.customer.code,
    'customer.address': customerAddressLine(d.customer),
    'customer.email': d.customer.email ?? '',
    'customer.phone': d.customer.phone ?? '',
    'customer.taxId': d.customer.taxId ?? '',
    'payment.amount': formatMoney(d.amount),
    'payment.method': PAYMENT_METHOD_LABELS[d.method] ?? d.method,
    'payment.date': formatDate(d.date),
    'payment.reference': d.reference ?? d.paymentRef ?? '',
    'payment.invoiceRef': d.invoice.ref,
    'payment.remaining': formatMoney(remaining),
  }
}

// ---------------------------------------------------------------------------
// Line-document view (invoice / proposal / order / supplier invoice)
// ---------------------------------------------------------------------------
function LineDocView({
  data,
  config,
  settings,
  docType,
  dueLabel,
  billToLabel = 'Bill to',
}: {
  data: InvoicePrintData
  config: TemplateConfig
  settings: SettingsMap
  docType: string
  dueLabel: string
  billToLabel?: string
}) {
  const accent = config.accentColor
  const f = config.fields
  const colCount =
    1 + // #
    (f.showDescription ? 1 : 0) +
    (f.showQty ? 1 : 0) +
    (f.showUnitPrice ? 1 : 0) +
    (f.showDiscount ? 1 : 0) +
    (f.showVat ? 1 : 0) +
    1 // Amount
  const values = useMemo(() => buildInvoiceValues(data, settings, docType), [data, settings, docType])
  const title = resolvePlaceholders(config.titlePattern, values)
  const headerNote = config.headerNote ? resolvePlaceholders(config.headerNote, values) : ''
  const footerNote = config.footerNote ? resolvePlaceholders(config.footerNote, values) : ''

  return (
    <div className="relative bg-white">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <CompanyBlock config={config} settings={settings} />
        <div className="flex flex-col items-end gap-2">
          <h1 className="text-right text-2xl font-extrabold leading-tight" style={{ color: accent }}>
            {title}
          </h1>
          <MetaBox
            rows={[
              { label: 'Status', value: STATUS_LABELS[data.status] ?? data.status },
              { label: 'Date', value: formatDate(data.date) },
              { label: data.dueDate ? dueLabel : '', value: data.dueDate ? formatDate(data.dueDate) : '' },
              { label: 'Linked doc', value: data.linkedRef ?? '' },
              { label: 'Reference', value: data.linkedRef ? data.ref : '' },
            ]}
          />
        </div>
      </div>

      {headerNote ? <p className="mt-3 text-[12px] italic text-neutral-500">{headerNote}</p> : null}

      <BillToCard tp={data.thirdParty} accentColor={accent} label={billToLabel} />

      {/* Lines table */}
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-neutral-100 text-left">
            <th className="border border-neutral-200 px-2.5 py-1.5 font-semibold">#</th>
            {f.showDescription && (
              <th className="border border-neutral-200 px-2.5 py-1.5 font-semibold">Description</th>
            )}
            {f.showQty && <th className="border border-neutral-200 px-2.5 py-1.5 text-right font-semibold">Qty</th>}
            {f.showUnitPrice && (
              <th className="border border-neutral-200 px-2.5 py-1.5 text-right font-semibold">Unit price</th>
            )}
            {f.showDiscount && (
              <th className="border border-neutral-200 px-2.5 py-1.5 text-right font-semibold">Discount %</th>
            )}
            {f.showVat && (
              <th className="border border-neutral-200 px-2.5 py-1.5 text-right font-semibold">VAT %</th>
            )}
            <th className="border border-neutral-200 px-2.5 py-1.5 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.length === 0 ? (
            <tr>
              <td
                colSpan={colCount}
                className="border border-neutral-200 px-2.5 py-3 text-center text-[11.5px] italic text-neutral-400"
              >
                No line items — totals entered directly
              </td>
            </tr>
          ) : (
            data.lines.map((l, i) => (
            <tr key={`${l.label}-${i}`} className={i % 2 === 1 ? 'bg-neutral-50' : undefined}>
              <td className="border border-neutral-200 px-2.5 py-1.5 text-neutral-500">{i + 1}</td>
              {f.showDescription && (
                <td className="border border-neutral-200 px-2.5 py-1.5">
                  <span className="block font-semibold">{l.label}</span>
                  {l.description ? <span className="block text-[11px] text-neutral-500">{l.description}</span> : null}
                </td>
              )}
              {f.showQty && (
                <td className="border border-neutral-200 px-2.5 py-1.5 text-right tabular-nums">{l.qty}</td>
              )}
              {f.showUnitPrice && (
                <td className="border border-neutral-200 px-2.5 py-1.5 text-right tabular-nums">
                  {formatMoney(l.unitPrice)}
                </td>
              )}
              {f.showDiscount && (
                <td className="border border-neutral-200 px-2.5 py-1.5 text-right tabular-nums">{l.discountPct}</td>
              )}
              {f.showVat && (
                <td className="border border-neutral-200 px-2.5 py-1.5 text-right tabular-nums">{l.vatRate}%</td>
              )}
              <td className="border border-neutral-200 px-2.5 py-1.5 text-right font-medium tabular-nums">
                {formatMoney(computeLineTotal(l))}
              </td>
            </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Totals */}
      <div className="ml-auto mt-4 w-64 space-y-1 text-[13px]">
        <div className="flex justify-between">
          <span className="text-neutral-500">Subtotal</span>
          <span className="tabular-nums">{formatMoney(data.subtotal)}</span>
        </div>
        {f.showDiscount && data.discountTotal > 0 && (
          <div className="flex justify-between">
            <span className="text-neutral-500">Discount</span>
            <span className="tabular-nums">−{formatMoney(data.discountTotal)}</span>
          </div>
        )}
        {f.showVat && (
          <div className="flex justify-between">
            <span className="text-neutral-500">VAT total</span>
            <span className="tabular-nums">{formatMoney(data.vatTotal)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-neutral-300 pt-1.5">
          <span className="font-bold">TOTAL</span>
          <span className="text-lg font-extrabold tabular-nums" style={{ color: accent }}>
            {formatMoney(data.total)}
          </span>
        </div>
        {data.paidAmount !== undefined && (
          <div className="flex justify-between">
            <span className="text-neutral-500">Amount paid</span>
            <span className="tabular-nums">{formatMoney(data.paidAmount)}</span>
          </div>
        )}
        {data.paidAmount !== undefined && (
          <div className="flex justify-between font-bold">
            <span>Amount due</span>
            <span className="tabular-nums">{formatMoney(Math.max(0, data.total - data.paidAmount))}</span>
          </div>
        )}
      </div>

      {/* Notes */}
      {f.showNotes && data.notes ? (
        <p
          className="mt-5 border-l-2 pl-3 text-[12px] italic text-neutral-600"
          style={{ borderColor: accent }}
        >
          {data.notes}
        </p>
      ) : null}

      <DocFooter config={config} settings={settings} footerNote={footerNote} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Receipt view
// ---------------------------------------------------------------------------
function ReceiptView({
  data,
  config,
  settings,
}: {
  data: ReceiptPrintData
  config: TemplateConfig
  settings: SettingsMap
}) {
  const accent = config.accentColor
  const remaining = Math.max(0, Math.round((data.invoice.total - data.invoice.paidAmount) * 100) / 100)
  const fullyPaid = remaining <= 0.001
  const values = useMemo(() => buildReceiptValues(data, settings), [data, settings])
  const title = resolvePlaceholders(config.titlePattern, values)
  const headerNote = config.headerNote ? resolvePlaceholders(config.headerNote, values) : ''
  const footerNote = config.footerNote ? resolvePlaceholders(config.footerNote, values) : ''

  const detailRows = [
    { label: 'Payment method', value: PAYMENT_METHOD_LABELS[data.method] ?? data.method },
    { label: 'Payment date', value: formatDate(data.date) },
    { label: 'Reference', value: data.reference ?? data.paymentRef ?? '—' },
    { label: 'For invoice', value: data.invoice.ref },
  ]

  return (
    <div className="relative bg-white">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <CompanyBlock config={config} settings={settings} />
        <div className="flex flex-col items-end gap-2">
          <h1 className="text-right text-2xl font-extrabold leading-tight" style={{ color: accent }}>
            {title}
          </h1>
          <MetaBox
            rows={[
              { label: 'Invoice', value: data.invoice.ref },
              { label: 'Invoice total', value: formatMoney(data.invoice.total) },
              { label: 'Status', value: fullyPaid ? (STATUS_LABELS.PAID ?? 'Paid') : (STATUS_LABELS.PARTIAL ?? 'Partially paid') },
            ]}
          />
        </div>
      </div>

      {headerNote ? <p className="mt-3 text-[12px] italic text-neutral-500">{headerNote}</p> : null}

      <BillToCard tp={data.customer} accentColor={accent} />

      {/* Receipt panel */}
      <div className="relative my-6 rounded-lg border border-neutral-300 px-6 py-8 text-center">
        {config.fields.showPaidBadge && fullyPaid && <PaidStamp accentColor={accent} />}
        <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">Amount received</p>
        <p className="mt-1 text-4xl font-extrabold tabular-nums" style={{ color: accent }}>
          {formatMoney(data.amount)}
        </p>
        <p className="mt-4 text-[13px]">
          Received from <span className="font-bold">{data.customer.name}</span>{' '}
          <span className="text-neutral-400">({data.customer.code})</span>
        </p>
        <div className="mx-auto mt-4 max-w-xs space-y-1 text-[12.5px]">
          {detailRows.map((r) => (
            <div key={r.label} className="flex justify-between gap-6">
              <span className="text-neutral-500">{r.label}</span>
              <span className="font-medium">{r.value}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[12.5px]">
          Remaining balance on {data.invoice.ref}:{' '}
          <span className={fullyPaid ? 'font-bold text-emerald-700' : 'font-bold text-amber-700'}>
            {formatMoney(remaining)}
          </span>
        </p>
      </div>

      <DocFooter config={config} settings={settings} footerNote={footerNote} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// DocumentPrintDialog
// ---------------------------------------------------------------------------
const DUE_LABELS: Partial<Record<DocKind, string>> = {
  INVOICE: 'Due date',
  SUPPLIER_INVOICE: 'Due date',
  PROPOSAL: 'Valid until',
  ORDER: 'Delivery date',
}

export function DocumentPrintDialog({
  open,
  onOpenChange,
  kind,
  data,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: DocKind
  data: InvoicePrintData | ReceiptPrintData
}) {
  const { settings, load } = useSettingsStore()

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const templateQ = useDocTemplate(kind, open)
  const config = templateQ.data?.config ?? DEFAULT_TEMPLATE_CONFIG
  const templateName = templateQ.data?.name ?? 'Default template'
  const printNow = usePrintNow(config.paperSize)

  const isReceipt = kind === 'RECEIPT'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader className="no-print">
          <DialogTitle className="sr-only">Document preview</DialogTitle>
          <DialogDescription className="sr-only">
            Branded {DOC_TYPE_LABELS[kind] ?? kind} preview — print it or save it as PDF.
          </DialogDescription>
        </DialogHeader>

        {/* Toolbar */}
        <div className="no-print flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {templateQ.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
            ) : (
              <Badge variant="secondary">{templateName}</Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {config.paperSize === 'LETTER' ? 'Letter 8.5×11"' : 'A4 210×297mm'} · Save as PDF ready
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={printNow} disabled={templateQ.isLoading}>
              <Printer className="h-4 w-4" /> Print / Save PDF
            </Button>
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" /> Close
            </Button>
          </div>
        </div>

        {/* Preview */}
        <div className="max-h-[70vh] overflow-y-auto rounded-md bg-neutral-100 p-4">
          <div
            className="print-area mx-auto border bg-white text-neutral-900 shadow-md"
            style={printAreaStyle(config.paperSize)}
          >
            {isReceipt && 'invoice' in data ? (
              <ReceiptView data={data} config={config} settings={settings} />
            ) : !isReceipt && 'lines' in data ? (
              <LineDocView
                data={data}
                config={config}
                settings={settings}
                docType={DOC_TYPE_LABELS[kind] ?? kind}
                dueLabel={DUE_LABELS[kind] ?? 'Due date'}
                billToLabel={kind === 'SUPPLIER_INVOICE' ? 'Supplier' : 'Bill to'}
              />
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

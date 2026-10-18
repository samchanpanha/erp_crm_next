/**
 * Isomorphic template + settings schema for printable documents
 * (invoices, receipts, proposals, orders, supplier invoices).
 * Used by API routes (zod validation) and UI (designer, print engine, preview).
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Settings keys & defaults
// ---------------------------------------------------------------------------
export const SETTING_DEFAULTS: Record<string, string> = {
  'company.name': 'DoliNext Demo Ltd',
  'company.legalName': 'DoliNext Demo Ltd — a demo company',
  'company.address': '12 Commerce Street',
  'company.zip': '12000',
  'company.city': 'Phnom Penh',
  'company.country': 'Cambodia',
  'company.phone': '+855 12 345 678',
  'company.email': 'billing@dolinext.example',
  'company.website': 'www.dolinext.example',
  'company.taxId': 'VAT-KH-001234567',
  'company.bankDetails': 'ACME Bank · IBAN KH00 1234 5678 9012 345 · SWIFT ABCDKHPP',
  'company.logoDataUrl': '',
  'sales.defaultVatRate': '20',
  'sales.defaultPaymentTerms': 'NET30',
  'app.currency': 'USD',
  'app.dateFormat': 'DD/MM/YYYY',
}

export const SETTING_META: {
  key: string
  label: string
  group: 'company' | 'sales' | 'app'
  type: 'text' | 'textarea' | 'logo' | 'select'
  options?: { value: string; label: string }[]
  placeholder?: string
}[] = [
  { key: 'company.name', label: 'Company name', group: 'company', type: 'text' },
  { key: 'company.legalName', label: 'Legal name', group: 'company', type: 'text' },
  { key: 'company.address', label: 'Address', group: 'company', type: 'textarea' },
  { key: 'company.zip', label: 'ZIP / Postal code', group: 'company', type: 'text' },
  { key: 'company.city', label: 'City', group: 'company', type: 'text' },
  { key: 'company.country', label: 'Country', group: 'company', type: 'text' },
  { key: 'company.phone', label: 'Phone', group: 'company', type: 'text' },
  { key: 'company.email', label: 'Email', group: 'company', type: 'text' },
  { key: 'company.website', label: 'Website', group: 'company', type: 'text' },
  { key: 'company.taxId', label: 'Tax / VAT number', group: 'company', type: 'text' },
  { key: 'company.bankDetails', label: 'Bank details (shown on documents)', group: 'company', type: 'textarea' },
  { key: 'company.logoDataUrl', label: 'Company logo', group: 'company', type: 'logo' },
  { key: 'sales.defaultVatRate', label: 'Default VAT rate (%)', group: 'sales', type: 'text' },
  {
    key: 'sales.defaultPaymentTerms',
    label: 'Default payment terms',
    group: 'sales',
    type: 'select',
    options: [
      { value: 'ON_ORDER', label: 'On order' },
      { value: 'NET15', label: 'Net 15 days' },
      { value: 'NET30', label: 'Net 30 days' },
      { value: 'NET60', label: 'Net 60 days' },
    ],
  },
  {
    key: 'app.currency',
    label: 'Currency',
    group: 'app',
    type: 'select',
    options: [
      { value: 'USD', label: 'USD — US Dollar' },
      { value: 'EUR', label: 'EUR — Euro' },
      { value: 'KHR', label: 'KHR — Riel' },
      { value: 'GBP', label: 'GBP — Pound Sterling' },
    ],
  },
  {
    key: 'app.dateFormat',
    label: 'Date format',
    group: 'app',
    type: 'select',
    options: [
      { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
      { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
      { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Document template config (JSON blob persisted in DocTemplate.config)
// ---------------------------------------------------------------------------
export const TEMPLATE_TYPES = ['INVOICE', 'RECEIPT', 'PROPOSAL', 'ORDER', 'SUPPLIER_INVOICE'] as const
export type TemplateType = (typeof TEMPLATE_TYPES)[number]

export const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
  INVOICE: 'Customer invoice',
  RECEIPT: 'Payment receipt',
  PROPOSAL: 'Commercial proposal',
  ORDER: 'Sale order',
  SUPPLIER_INVOICE: 'Supplier invoice',
}

export const templateConfigSchema = z.object({
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color like #ea580c').default('#ea580c'),
  paperSize: z.enum(['A4', 'LETTER']).default('A4'),
  titlePattern: z.string().min(1).default('{{doc.type}} {{doc.ref}}'),
  headerNote: z.string().default(''),
  footerNote: z.string().default(''),
  fields: z
    .object({
      showLogo: z.boolean().default(true),
      showQty: z.boolean().default(true),
      showUnitPrice: z.boolean().default(true),
      showDiscount: z.boolean().default(true),
      showVat: z.boolean().default(true),
      showDescription: z.boolean().default(true),
      showPaymentTerms: z.boolean().default(true),
      showBankDetails: z.boolean().default(true),
      showSignature: z.boolean().default(true),
      showNotes: z.boolean().default(true),
      showPaidBadge: z.boolean().default(true),
    })
    .default({
      showLogo: true,
      showQty: true,
      showUnitPrice: true,
      showDiscount: true,
      showVat: true,
      showDescription: true,
      showPaymentTerms: true,
      showBankDetails: true,
      showSignature: true,
      showNotes: true,
      showPaidBadge: true,
    }),
})

export type TemplateConfig = z.infer<typeof templateConfigSchema>

export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = templateConfigSchema.parse({})

// ---------------------------------------------------------------------------
// Parameter fields (placeholders usable in title / header / footer texts)
// ---------------------------------------------------------------------------
export interface PlaceholderDef {
  token: string
  label: string
  group: 'Company' | 'Document' | 'Customer' | 'Payment'
  example: string
}

export const PLACEHOLDERS: PlaceholderDef[] = [
  { token: 'company.name', label: 'Company name', group: 'Company', example: 'DoliNext Demo Ltd' },
  { token: 'company.legalName', label: 'Legal name', group: 'Company', example: 'DoliNext Demo Ltd' },
  { token: 'company.address', label: 'Company address (full)', group: 'Company', example: '12 Commerce Street, 12000 Phnom Penh, Cambodia' },
  { token: 'company.phone', label: 'Company phone', group: 'Company', example: '+855 12 345 678' },
  { token: 'company.email', label: 'Company email', group: 'Company', example: 'billing@dolinext.example' },
  { token: 'company.website', label: 'Company website', group: 'Company', example: 'www.dolinext.example' },
  { token: 'company.taxId', label: 'Company tax ID', group: 'Company', example: 'VAT-KH-001234567' },
  { token: 'company.bankDetails', label: 'Bank details', group: 'Company', example: 'ACME Bank · IBAN …' },
  { token: 'doc.type', label: 'Document type label', group: 'Document', example: 'Invoice' },
  { token: 'doc.ref', label: 'Document reference', group: 'Document', example: 'IN2610-0004' },
  { token: 'doc.date', label: 'Document date', group: 'Document', example: '15/10/2026' },
  { token: 'doc.dueDate', label: 'Due date', group: 'Document', example: '14/11/2026' },
  { token: 'doc.status', label: 'Status (readable)', group: 'Document', example: 'Unpaid' },
  { token: 'doc.subtotal', label: 'Subtotal', group: 'Document', example: '$1,080.00' },
  { token: 'doc.discountTotal', label: 'Discount total', group: 'Document', example: '$0.00' },
  { token: 'doc.vatTotal', label: 'VAT total', group: 'Document', example: '$216.00' },
  { token: 'doc.total', label: 'Grand total', group: 'Document', example: '$1,296.00' },
  { token: 'doc.paidAmount', label: 'Amount paid', group: 'Document', example: '$1,296.00' },
  { token: 'doc.dueAmount', label: 'Amount due', group: 'Document', example: '$0.00' },
  { token: 'doc.notes', label: 'Document notes', group: 'Document', example: 'Thank you for your business' },
  { token: 'customer.name', label: 'Customer name', group: 'Customer', example: 'Globex Corporation' },
  { token: 'customer.code', label: 'Customer code', group: 'Customer', example: 'CU2601-0002' },
  { token: 'customer.address', label: 'Customer address (full)', group: 'Customer', example: '…' },
  { token: 'customer.email', label: 'Customer email', group: 'Customer', example: '…' },
  { token: 'customer.phone', label: 'Customer phone', group: 'Customer', example: '…' },
  { token: 'customer.taxId', label: 'Customer tax ID', group: 'Customer', example: '…' },
  { token: 'payment.amount', label: 'Payment amount', group: 'Payment', example: '$1,296.00' },
  { token: 'payment.method', label: 'Payment method', group: 'Payment', example: 'Bank transfer' },
  { token: 'payment.date', label: 'Payment date', group: 'Payment', example: '16/10/2026' },
  { token: 'payment.reference', label: 'Payment reference', group: 'Payment', example: 'TR-8842' },
  { token: 'payment.invoiceRef', label: 'Related invoice ref', group: 'Payment', example: 'IN2610-0004' },
  { token: 'payment.remaining', label: 'Remaining balance', group: 'Payment', example: '$0.00' },
]

/** Replace {{token}} placeholders. Unknown tokens resolve to '—'. */
export function resolvePlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, token: string) => {
    const v = values[token]
    return v === undefined || v === null || v === '' ? '—' : v
  })
}

export const DOC_TYPE_LABELS: Record<string, string> = {
  INVOICE: 'Invoice',
  RECEIPT: 'Payment receipt',
  PROPOSAL: 'Commercial proposal',
  ORDER: 'Sale order',
  SUPPLIER_INVOICE: 'Supplier invoice',
  SALE_ORDER: 'Sale order',
  PURCHASE_ORDER: 'Purchase order',
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  CHECK: 'Check',
  OTHER: 'Other',
}

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  VALIDATED: 'Validated',
  ACCEPTED: 'Accepted',
  REFUSED: 'Refused',
  CLOSED: 'Closed',
  UNPAID: 'Unpaid',
  PARTIAL: 'Partially paid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
  DELIVERED: 'Delivered',
  BILLED: 'Billed',
  RECEIVED: 'Received',
}

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { hasPerm } from '@/lib/permissions'
import {
  SETTING_DEFAULTS,
  templateConfigSchema,
  DEFAULT_TEMPLATE_CONFIG,
} from '@/lib/template-schema'
import {
  buildDocumentPdf,
  isPdfDocKind,
  type PdfDocKind,
  type PdfInvoiceData,
  type PdfReceiptData,
} from '@/lib/pdf-document'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/documents/[kind]/[id]/pdf — branded, template-driven PDF download.
// kind: INVOICE | PROPOSAL | ORDER | SUPPLIER_INVOICE | RECEIPT
// Uses the tenant's default template for the kind + tenant settings so the
// PDF matches the on-screen print preview (accent color, logo, notes, fields).
// ---------------------------------------------------------------------------

const KIND_PERM: Record<PdfDocKind, string> = {
  INVOICE: 'invoices',
  PROPOSAL: 'proposals',
  ORDER: 'saleorders',
  SUPPLIER_INVOICE: 'supplierinvoices',
  RECEIPT: 'payments',
}

function parseConfig(raw: string | undefined | null) {
  if (!raw) return DEFAULT_TEMPLATE_CONFIG
  try {
    const parsed = templateConfigSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : DEFAULT_TEMPLATE_CONFIG
  } catch {
    return DEFAULT_TEMPLATE_CONFIG
  }
}

function asciiFileName(prefix: string, ref: string): string {
  const safe = `${prefix}-${ref}`.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return `${safe || 'document'}.pdf`
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  try {
    const ctx = await requireAuth()
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { kind, id } = await params
    if (!isPdfDocKind(kind)) {
      return NextResponse.json({ error: 'Unknown document kind' }, { status: 404 })
    }
    if (!hasPerm(user.permissions, `${KIND_PERM[kind]}.view`)) {
      return NextResponse.json(
        { error: 'You do not have permission to perform this action.' },
        { status: 403 },
      )
    }

    // Tenant settings (defaults overlaid by stored values) — same merge as GET /api/settings
    const settingRows = await db.setting.findMany({ where: { tenantId: user.tenantId } })
    const settings = {
      ...SETTING_DEFAULTS,
      ...Object.fromEntries(settingRows.map((r) => [r.key, r.value])),
    }

    // Default template for the kind (isDefault wins, else first)
    const templates = await db.docTemplate.findMany({
      where: { tenantId: user.tenantId, type: kind },
      orderBy: { createdAt: 'asc' },
    })
    const tpl = templates.find((t) => t.isDefault) ?? templates[0]
    const config = parseConfig(tpl?.config)

    let bytes: Uint8Array
    let fileName: string

    if (kind === 'RECEIPT') {
      const payment = await db.payment.findFirst({
        where: { id, tenantId: user.tenantId },
        include: {
          invoice: { include: { thirdParty: true } },
          supplierInvoice: { include: { thirdParty: true } },
        },
      })
      const doc = payment?.invoice ?? payment?.supplierInvoice
      if (!payment || !doc) {
        return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
      }
      const data: PdfReceiptData = {
        id: payment.id,
        paymentRef: doc.ref,
        amount: payment.amount,
        method: payment.method,
        date: payment.date.toISOString(),
        reference: payment.reference,
        invoice: {
          ref: doc.ref,
          total: doc.total,
          paidAmount: doc.paidAmount,
        },
        customer: {
          name: doc.thirdParty.name,
          code: doc.thirdParty.code,
          address: doc.thirdParty.address,
          email: doc.thirdParty.email,
          phone: doc.thirdParty.phone,
          taxId: doc.thirdParty.vatNumber,
        },
      }
      fileName = asciiFileName('receipt', doc.ref)
      bytes = await buildDocumentPdf({ kind, data, config, settings })
    } else {
      const data = await loadLineDoc(kind, id, user.tenantId)
      if (!data) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      }
      fileName = asciiFileName(kind.toLowerCase(), data.ref)
      bytes = await buildDocumentPdf({ kind, data, config, settings })
    }

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('GET /api/documents/[kind]/[id]/pdf failed', err)
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Line-document loading — maps DB rows onto the PDF payload shape, mirroring
// the client module mappers (print data shapes).
// ---------------------------------------------------------------------------

async function loadLineDoc(
  kind: PdfDocKind,
  id: string,
  tenantId: string,
): Promise<PdfInvoiceData | null> {
  switch (kind) {
    case 'INVOICE': {
      const inv = await db.invoice.findFirst({
        where: { id, tenantId },
        include: {
          thirdParty: true,
          saleOrder: { select: { ref: true } },
          lines: { orderBy: { sort: 'asc' } },
        },
      })
      if (!inv) return null
      return {
        ref: inv.ref,
        date: inv.date.toISOString(),
        dueDate: inv.dueDate?.toISOString() ?? null,
        status: inv.status,
        subtotal: inv.subtotal,
        discountTotal: inv.discountTotal,
        vatTotal: inv.vatTotal,
        total: inv.total,
        paidAmount: inv.paidAmount,
        notes: inv.notes,
        thirdParty: tpOf(inv.thirdParty),
        lines: inv.lines.map((l) => ({
          label: l.label,
          description: l.description,
          qty: l.qty,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          vatRate: l.vatRate,
        })),
        linkedRef: inv.saleOrder?.ref,
      }
    }
    case 'PROPOSAL': {
      const p = await db.proposal.findFirst({
        where: { id, tenantId },
        include: { thirdParty: true, lines: { orderBy: { sort: 'asc' } } },
      })
      if (!p) return null
      return {
        ref: p.ref,
        date: p.date.toISOString(),
        dueDate: p.validUntil?.toISOString() ?? null,
        status: p.status,
        subtotal: p.subtotal,
        discountTotal: p.discountTotal,
        vatTotal: p.vatTotal,
        total: p.total,
        notes: p.notes,
        thirdParty: tpOf(p.thirdParty),
        lines: p.lines.map((l) => ({
          label: l.label,
          description: l.description,
          qty: l.qty,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          vatRate: l.vatRate,
        })),
      }
    }
    case 'ORDER': {
      const o = await db.saleOrder.findFirst({
        where: { id, tenantId },
        include: { thirdParty: true, lines: { orderBy: { sort: 'asc' } } },
      })
      if (!o) return null
      return {
        ref: o.ref,
        date: o.date.toISOString(),
        dueDate: o.deliveryDate?.toISOString() ?? null,
        status: o.status,
        subtotal: o.subtotal,
        discountTotal: o.discountTotal,
        vatTotal: o.vatTotal,
        total: o.total,
        notes: o.notes,
        thirdParty: tpOf(o.thirdParty),
        lines: o.lines.map((l) => ({
          label: l.label,
          description: l.description,
          qty: l.qty,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          vatRate: l.vatRate,
        })),
      }
    }
    case 'SUPPLIER_INVOICE': {
      const si = await db.supplierInvoice.findFirst({
        where: { id, tenantId },
        include: { thirdParty: true },
      })
      if (!si) return null
      return {
        ref: si.ref,
        date: si.date.toISOString(),
        dueDate: si.dueDate?.toISOString() ?? null,
        status: si.status,
        subtotal: si.subtotal,
        discountTotal: 0,
        vatTotal: si.vatTotal,
        total: si.total,
        paidAmount: si.paidAmount,
        notes: si.notes,
        thirdParty: tpOf(si.thirdParty),
        lines: [],
      }
    }
    default:
      return null
  }
}

function tpOf(tp: {
  name: string
  code: string
  address: string | null
  zip: string | null
  city: string | null
  country: string | null
  email: string | null
  phone: string | null
  vatNumber: string | null
}): PdfInvoiceData['thirdParty'] {
  return {
    name: tp.name,
    code: tp.code,
    address: tp.address,
    zip: tp.zip,
    city: tp.city,
    country: tp.country,
    email: tp.email,
    phone: tp.phone,
    taxId: tp.vatNumber,
  }
}

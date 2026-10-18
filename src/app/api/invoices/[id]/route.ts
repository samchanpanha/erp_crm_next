import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { computeTotals } from '@/lib/doc-math'

export const dynamic = 'force-dynamic'

const INVOICE_ACTIONS = ['validate', 'cancel'] as const

const optionalDate = z
  .string()
  .optional()
  .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), 'Invalid date')

const lineSchema = z.object({
  productId: z.string().min(1).optional().nullable(),
  label: z.string().trim().min(1, 'Line label is required'),
  description: z.string().optional().nullable(),
  qty: z.number().positive('Quantity must be greater than 0'),
  unitPrice: z.number().min(0, 'Unit price must be >= 0'),
  discountPct: z.number().min(0).max(100).default(0),
  vatRate: z.number().min(0).max(100).default(20),
})

const actionSchema = z.object({ action: z.enum(INVOICE_ACTIONS) })

const editSchema = z.object({
  thirdPartyId: z.string().min(1, 'Third party is required'),
  date: optionalDate,
  dueDate: optionalDate,
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, 'At least one line is required'),
})

const invoiceInclude = {
  thirdParty: {
    select: {
      id: true,
      name: true,
      code: true,
      address: true,
      zip: true,
      city: true,
      country: true,
      email: true,
      phone: true,
      vatNumber: true,
    },
  },
  lines: { orderBy: { sort: 'asc' } },
  payments: { orderBy: { date: 'desc' } },
  saleOrder: { select: { id: true, ref: true, status: true } },
} as const

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** Server-side status transition rules for customer invoices */
function applyAction(
  current: string,
  action: (typeof INVOICE_ACTIONS)[number]
): { ok: true } | { ok: false; error: string } {
  switch (action) {
    case 'validate':
      if (current !== 'DRAFT') return { ok: false, error: `Cannot validate an invoice in status ${current}` }
      return { ok: true }
    case 'cancel':
      if (current === 'PAID') return { ok: false, error: 'A paid invoice cannot be cancelled' }
      if (!['DRAFT', 'UNPAID', 'PARTIAL'].includes(current))
        return { ok: false, error: `Cannot cancel an invoice in status ${current}` }
      return { ok: true }
  }
}

// ---------------------------------------------------------------------------
// GET /api/invoices/:id — detail incl. lines + payments
// ---------------------------------------------------------------------------
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const invoice = await db.invoice.findUnique({
      where: { id },
      include: invoiceInclude,
    })
    if (!invoice) return bad('Invoice not found', 404)
    return NextResponse.json({ data: invoice })
  } catch (err) {
    console.error('GET /api/invoices/[id] failed', err)
    return bad('Failed to load invoice', 500)
  }
}

// ---------------------------------------------------------------------------
// PUT /api/invoices/:id — action mode OR full edit (DRAFT only)
// ---------------------------------------------------------------------------
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const invoice = await db.invoice.findUnique({ where: { id }, include: invoiceInclude })
    if (!invoice) return bad('Invoice not found', 404)

    // ----- Action mode -----
    const actionParsed = actionSchema.safeParse(body)
    if (actionParsed.success) {
      const action = actionParsed.data.action
      const check = applyAction(invoice.status, action)
      if (!check.ok) return bad(check.error)

      const nextStatus = action === 'validate' ? 'UNPAID' : 'CANCELLED'
      const updated = await db.invoice.update({
        where: { id },
        data: { status: nextStatus },
        include: invoiceInclude,
      })
      return NextResponse.json({ data: updated })
    }

    // ----- Full edit mode (DRAFT only). paidAmount is never editable here. -----
    if (invoice.status !== 'DRAFT') {
      return bad('Only draft invoices can be edited — use an action instead')
    }
    const editParsed = editSchema.safeParse(body)
    if (!editParsed.success) {
      return bad(editParsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const { thirdPartyId, date, dueDate, notes, lines } = editParsed.data

    const thirdParty = await db.thirdParty.findUnique({ where: { id: thirdPartyId } })
    if (!thirdParty) return bad('Third party not found')

    const totals = computeTotals(lines)
    const updated = await db.invoice.update({
      where: { id },
      data: {
        thirdPartyId,
        date: date ? new Date(date) : invoice.date,
        dueDate: dueDate ? new Date(dueDate) : null,
        notes: notes ?? null,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        vatTotal: totals.vatTotal,
        total: totals.total,
        lines: {
          deleteMany: {},
          create: lines.map((l, i) => ({
            productId: l.productId ?? null,
            label: l.label,
            description: l.description ?? null,
            qty: l.qty,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            vatRate: l.vatRate,
            sort: i,
          })),
        },
      },
      include: invoiceInclude,
    })
    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/invoices/[id] failed', err)
    return bad('Failed to update invoice', 500)
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/invoices/:id — DRAFT only
// ---------------------------------------------------------------------------
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const invoice = await db.invoice.findUnique({ where: { id } })
    if (!invoice) return bad('Invoice not found', 404)
    if (invoice.status !== 'DRAFT') return bad('Only draft invoices can be deleted')
    await db.invoice.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/invoices/[id] failed', err)
    return bad('Failed to delete invoice', 500)
  }
}

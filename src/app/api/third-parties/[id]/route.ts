import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const TYPES = ['CUSTOMER', 'PROSPECT', 'SUPPLIER', 'CUSTOMER_SUPPLIER'] as const
const STATUSES = ['ACTIVE', 'SUSPENDED'] as const
const PAYMENT_TERMS = ['ON_ORDER', 'NET15', 'NET30', 'NET60'] as const

type TPType = (typeof TYPES)[number]
type TPStatus = (typeof STATUSES)[number]
type TPPaymentTerms = (typeof PAYMENT_TERMS)[number]

const nullableText = (max: number) =>
  z.preprocess(
    (v) => {
      if (v === undefined || v === null) return null
      if (typeof v === 'string') {
        const t = v.trim()
        return t.length ? t.slice(0, max) : null
      }
      return v
    },
    z.string().max(max).nullable(),
  )

const optionalText = (max: number) =>
  z.preprocess(
    (v) => {
      if (v === undefined) return undefined
      if (v === null) return null
      if (typeof v === 'string') {
        const t = v.trim()
        return t.length ? t.slice(0, max) : null
      }
      return v
    },
    z.string().max(max).nullable().optional(),
  )

const nullableEmail = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return null
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase()
      return t.length ? t : null
    }
    return v
  },
  z.email('Invalid email address').max(200).nullable(),
)

const optionalEmail = z.preprocess(
  (v) => {
    if (v === undefined) return undefined
    if (v === null) return null
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase()
      return t.length ? t : null
    }
    return v
  },
  z.email('Invalid email address').max(200).nullable().optional(),
)

const updateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200, 'Name is too long').optional(),
  type: z.enum(TYPES).optional(),
  status: z.enum(STATUSES).optional(),
  email: optionalEmail,
  phone: optionalText(50),
  website: optionalText(200),
  address: optionalText(300),
  zip: optionalText(20),
  city: optionalText(100),
  country: optionalText(100),
  vatNumber: optionalText(50),
  paymentTerms: z.enum(PAYMENT_TERMS).optional(),
  notes: optionalText(2000),
})

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

const detailInclude = {
  contacts: { orderBy: [{ isPrimary: 'desc' as const }, { lastName: 'asc' as const }, { firstName: 'asc' as const }] },
  _count: {
    select: {
      contacts: true,
      opportunities: true,
      proposals: true,
      saleOrders: true,
      invoices: true,
      contracts: true,
      purchaseOrders: true,
      supplierInvoices: true,
      tickets: true,
      projects: true,
      agendaEvents: true,
    },
  },
}

// ---------------------------------------------------------------------------
// GET /api/third-parties/:id → { data: ThirdParty & { contacts, _count } }
// ---------------------------------------------------------------------------
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('thirdparties.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const tp = await db.thirdParty.findFirst({
      where: { id, tenantId: user.tenantId },
      include: detailInclude,
    })
    if (!tp) return bad('Not found', 404)
    return NextResponse.json({ data: tp })
  } catch (err) {
    console.error('GET /api/third-parties/[id] failed', err)
    return bad('Failed to load third party', 500)
  }
}

// ---------------------------------------------------------------------------
// PUT /api/third-parties/:id → { data: ThirdParty }
// ---------------------------------------------------------------------------
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('thirdparties.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.thirdParty.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!existing) return bad('Not found', 404)

    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))

    const data = stripUndefined(parsed.data)
    if (Object.keys(data).length === 0) return bad('No fields to update')

    const updated = await db.thirdParty.update({
      where: { id },
      data,
      include: detailInclude,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/third-parties/[id] failed', err)
    return bad('Failed to update third party', 500)
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/third-parties/:id
// - Blocked when business documents exist (proposals / orders / invoices /
//   contracts / purchase orders / supplier invoices) → 400.
// - Otherwise deletes; contacts + opportunities cascade (schema-level).
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('thirdparties.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.thirdParty.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!existing) return bad('Not found', 404)

    const [proposals, saleOrders, invoices, contracts, purchaseOrders, supplierInvoices] =
      await Promise.all([
        db.proposal.count({ where: { thirdPartyId: id } }),
        db.saleOrder.count({ where: { thirdPartyId: id } }),
        db.invoice.count({ where: { thirdPartyId: id } }),
        db.contract.count({ where: { thirdPartyId: id } }),
        db.purchaseOrder.count({ where: { thirdPartyId: id } }),
        db.supplierInvoice.count({ where: { thirdPartyId: id } }),
      ])

    const hasDocs =
      proposals > 0 || saleOrders > 0 || invoices > 0 ||
      contracts > 0 || purchaseOrders > 0 || supplierInvoices > 0

    if (hasDocs) return bad('Cannot delete: this third party has related documents')

    await db.thirdParty.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/third-parties/[id] failed', err)
    return bad('Failed to delete third party', 500)
  }
}

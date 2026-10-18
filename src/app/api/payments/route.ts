import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { invoiceStatusFromPaid, round2 } from '@/lib/doc-math'

export const dynamic = 'force-dynamic'

const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'CHECK', 'OTHER'] as const

const optionalDate = z
  .string()
  .optional()
  .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), 'Invalid date')

const createSchema = z
  .object({
    invoiceId: z.string().min(1).optional(),
    supplierInvoiceId: z.string().min(1).optional(),
    amount: z.number().positive('Amount must be greater than 0'),
    method: z.enum(PAYMENT_METHODS).default('BANK_TRANSFER'),
    date: optionalDate,
    reference: z.string().trim().optional(),
    note: z.string().trim().optional(),
    bankAccountId: z.string().min(1).optional(),
  })
  .refine((b) => Boolean(b.invoiceId) !== Boolean(b.supplierInvoiceId), {
    message: 'Provide exactly one of invoiceId or supplierInvoiceId',
  })

const paymentInclude = {
  invoice: {
    select: {
      id: true,
      ref: true,
      status: true,
      total: true,
      paidAmount: true,
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
    },
  },
  supplierInvoice: {
    select: {
      id: true,
      ref: true,
      status: true,
      total: true,
      paidAmount: true,
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
    },
  },
} as const

// ---------------------------------------------------------------------------
// GET /api/payments?q=&method= — payments on customer AND supplier invoices
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const method = url.searchParams.get('method')?.trim() ?? ''

    const payments = await db.payment.findMany({
      where: { ...(method ? { method } : {}) },
      include: paymentInclude,
      orderBy: { date: 'desc' },
    })

    const needle = q.toLowerCase()
    const filtered = needle
      ? payments.filter((p) => {
          const docRef = p.invoice?.ref ?? p.supplierInvoice?.ref ?? ''
          const tpName = p.invoice?.thirdParty.name ?? p.supplierInvoice?.thirdParty.name ?? ''
          return (
            (p.reference ?? '').toLowerCase().includes(needle) ||
            (p.note ?? '').toLowerCase().includes(needle) ||
            docRef.toLowerCase().includes(needle) ||
            tpName.toLowerCase().includes(needle)
          )
        })
      : payments

    return NextResponse.json({ data: filtered })
  } catch (err) {
    console.error('GET /api/payments failed', err)
    return NextResponse.json({ error: 'Failed to load payments' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/payments — record a payment against a customer or supplier invoice
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 }
      )
    }
    const { invoiceId, supplierInvoiceId, amount, method, date, reference, note, bankAccountId } = parsed.data
    const paidAt = date ? new Date(date) : new Date()

    // ----- Customer invoice payment -----
    if (invoiceId) {
      const invoice = await db.invoice.findUnique({ where: { id: invoiceId } })
      if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 400 })
      if (!['UNPAID', 'PARTIAL'].includes(invoice.status)) {
        return NextResponse.json(
          { error: `Invoice ${invoice.ref} is not open for payment (status ${invoice.status})` },
          { status: 400 }
        )
      }
      const remaining = round2(invoice.total - invoice.paidAmount)
      if (amount > remaining + 0.005) {
        return NextResponse.json(
          { error: `Payment exceeds remaining balance (${remaining.toFixed(2)} remaining)` },
          { status: 400 }
        )
      }

      const payment = await db.$transaction(async (tx) => {
        const newPaid = round2(invoice.paidAmount + amount)
        // update first so the payment include below reflects the new invoice state
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { paidAmount: newPaid, status: invoiceStatusFromPaid(invoice.total, newPaid) },
        })
        const created = await tx.payment.create({
          data: {
            amount,
            method,
            date: paidAt,
            reference: reference || null,
            note: note || null,
            invoiceId,
            bankAccountId: bankAccountId || null,
          },
          include: paymentInclude,
        })
        if (bankAccountId) {
          const account = await tx.bankAccount.findUnique({ where: { id: bankAccountId } })
          if (!account) throw new Error('BANK_ACCOUNT_NOT_FOUND')
          await tx.bankTransaction.create({
            data: {
              accountId: bankAccountId,
              date: paidAt,
              label: `Customer payment — ${invoice.ref}`,
              amount,
              category: 'SALES',
              reference: invoice.ref,
            },
          })
          await tx.bankAccount.update({
            where: { id: bankAccountId },
            data: { currentBalance: round2(account.currentBalance + amount) },
          })
        }
        return created
      })

      return NextResponse.json({ data: payment }, { status: 201 })
    }

    // ----- Supplier invoice payment -----
    if (supplierInvoiceId) {
      const supplierInvoice = await db.supplierInvoice.findUnique({ where: { id: supplierInvoiceId } })
      if (!supplierInvoice) return NextResponse.json({ error: 'Supplier invoice not found' }, { status: 400 })
      if (!['UNPAID', 'PARTIAL'].includes(supplierInvoice.status)) {
        return NextResponse.json(
          { error: `Supplier invoice ${supplierInvoice.ref} is not open for payment (status ${supplierInvoice.status})` },
          { status: 400 }
        )
      }
      const remaining = round2(supplierInvoice.total - supplierInvoice.paidAmount)
      if (amount > remaining + 0.005) {
        return NextResponse.json(
          { error: `Payment exceeds remaining balance (${remaining.toFixed(2)} remaining)` },
          { status: 400 }
        )
      }

      const payment = await db.$transaction(async (tx) => {
        const newPaid = round2(supplierInvoice.paidAmount + amount)
        // update first so the payment include below reflects the new invoice state
        await tx.supplierInvoice.update({
          where: { id: supplierInvoiceId },
          data: { paidAmount: newPaid, status: invoiceStatusFromPaid(supplierInvoice.total, newPaid) },
        })
        const created = await tx.payment.create({
          data: {
            amount,
            method,
            date: paidAt,
            reference: reference || null,
            note: note || null,
            supplierInvoiceId,
            bankAccountId: bankAccountId || null,
          },
          include: paymentInclude,
        })
        if (bankAccountId) {
          const account = await tx.bankAccount.findUnique({ where: { id: bankAccountId } })
          if (!account) throw new Error('BANK_ACCOUNT_NOT_FOUND')
          await tx.bankTransaction.create({
            data: {
              accountId: bankAccountId,
              date: paidAt,
              label: `Supplier payment — ${supplierInvoice.ref}`,
              amount: -amount,
              category: 'PURCHASES',
              reference: supplierInvoice.ref,
            },
          })
          await tx.bankAccount.update({
            where: { id: bankAccountId },
            data: { currentBalance: round2(account.currentBalance - amount) },
          })
        }
        return created
      })

      return NextResponse.json({ data: payment }, { status: 201 })
    }

    return NextResponse.json({ error: 'Provide exactly one of invoiceId or supplierInvoiceId' }, { status: 400 })
  } catch (err) {
    if (err instanceof Error && err.message === 'BANK_ACCOUNT_NOT_FOUND') {
      return NextResponse.json({ error: 'Bank account not found' }, { status: 400 })
    }
    console.error('POST /api/payments failed', err)
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }
}

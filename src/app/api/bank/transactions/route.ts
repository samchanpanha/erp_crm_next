import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { round2 } from '@/lib/doc-math'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const CATEGORIES = ['SALES', 'PURCHASES', 'SALARIES', 'EXPENSES', 'TRANSFER', 'OTHER'] as const

// ---------------------------------------------------------------------------
// GET /api/bank/transactions?accountId=&category=&q= — latest first
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const ctx = await requirePerm('bank.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const url = new URL(req.url)
    const accountId = url.searchParams.get('accountId')?.trim() ?? ''
    const category = url.searchParams.get('category')?.trim() ?? ''
    const q = url.searchParams.get('q')?.trim() ?? ''

    const where: Prisma.BankTransactionWhereInput = { tenantId: user.tenantId }
    if (accountId) where.accountId = accountId
    if ((CATEGORIES as readonly string[]).includes(category)) where.category = category
    if (q) where.OR = [{ label: { contains: q } }, { reference: { contains: q } }]

    const transactions = await db.bankTransaction.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: {
        account: { select: { id: true, name: true, type: true, currency: true } },
      },
    })

    return NextResponse.json({ data: transactions })
  } catch (err) {
    console.error('GET /api/bank/transactions failed', err)
    return NextResponse.json({ error: 'Failed to load bank transactions' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/bank/transactions — create a movement and update the account
// balance transactionally. `amount` is always positive; `direction` decides
// the sign (IN = credit +, OUT = debit −).
// ---------------------------------------------------------------------------
const createSchema = z.object({
  accountId: z.string().min(1, 'Account is required'),
  date: z
    .string()
    .optional()
    .nullable()
    .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), 'Invalid date'),
  label: z.string().trim().min(1, 'Label is required').max(200),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  direction: z.enum(['IN', 'OUT']),
  category: z.enum(CATEGORIES).optional().nullable(),
  reference: z.string().trim().max(120).optional().nullable(),
  reconciled: z.boolean().optional(),
})

export async function POST(req: Request) {
  try {
    const ctx = await requirePerm('bank.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const body = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 }
      )
    }
    const d = parsed.data

    const account = await db.bankAccount.findFirst({
      where: { id: d.accountId, tenantId: user.tenantId },
    })
    if (!account) {
      return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
    }

    const signed = d.direction === 'IN' ? d.amount : -d.amount
    const date = d.date ? new Date(d.date) : new Date()

    const transaction = await db.$transaction(async (tx) => {
      const created = await tx.bankTransaction.create({
        data: {
          tenantId: user.tenantId,
          accountId: d.accountId,
          date,
          label: d.label,
          amount: round2(signed),
          category: d.category || null,
          reference: d.reference || null,
          reconciled: d.reconciled ?? false,
        },
        include: {
          account: { select: { id: true, name: true, type: true, currency: true } },
        },
      })
      await tx.bankAccount.update({
        where: { id: d.accountId },
        data: { currentBalance: round2(account.currentBalance + signed) },
      })
      return created
    })

    return NextResponse.json({ data: transaction }, { status: 201 })
  } catch (err) {
    console.error('POST /api/bank/transactions failed', err)
    return NextResponse.json({ error: 'Failed to create bank transaction' }, { status: 500 })
  }
}

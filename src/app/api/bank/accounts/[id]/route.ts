import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/doc-math'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/bank/accounts/:id — one account + its transactions (latest first)
// ---------------------------------------------------------------------------
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const account = await db.bankAccount.findUnique({
      where: { id },
      include: {
        transactions: {
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          take: 500,
        },
        _count: { select: { transactions: true } },
      },
    })
    if (!account) {
      return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
    }
    return NextResponse.json({ data: account })
  } catch (err) {
    console.error('GET /api/bank/accounts/[id] failed', err)
    return NextResponse.json({ error: 'Failed to load bank account' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PUT /api/bank/accounts/:id — partial update. If openingBalance is present,
// currentBalance is recomputed: newOpening + Σ transactions.amount.
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120).optional(),
  bank: z.string().trim().max(120).optional().nullable(),
  accountNumber: z.string().trim().max(60).optional().nullable(),
  type: z.enum(['BANK', 'CASH']).optional(),
  openingBalance: z.coerce.number().min(0, 'Opening balance must be >= 0').optional(),
})

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const existing = await db.bankAccount.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 }
      )
    }
    const d = parsed.data

    const account = await db.$transaction(async (tx) => {
      const data: {
        name?: string
        bank?: string | null
        accountNumber?: string | null
        type?: string
        openingBalance?: number
        currentBalance?: number
      } = {}

      if (d.name !== undefined) data.name = d.name
      if (d.bank !== undefined) data.bank = d.bank || null
      if (d.accountNumber !== undefined) data.accountNumber = d.accountNumber || null
      if (d.type !== undefined) data.type = d.type

      if (d.openingBalance !== undefined) {
        const opening = round2(d.openingBalance)
        data.openingBalance = opening
        // Recompute the running balance from the new opening anchor.
        const agg = await tx.bankTransaction.aggregate({
          where: { accountId: id },
          _sum: { amount: true },
        })
        data.currentBalance = round2(opening + (agg._sum.amount ?? 0))
      }

      return tx.bankAccount.update({
        where: { id },
        data,
        include: { _count: { select: { transactions: true } } },
      })
    })

    return NextResponse.json({ data: account })
  } catch (err) {
    console.error('PUT /api/bank/accounts/[id] failed', err)
    return NextResponse.json({ error: 'Failed to update bank account' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/bank/accounts/:id — allowed only when the account has no
// transactions (they are the audit trail of the balance).
// ---------------------------------------------------------------------------
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const existing = await db.bankAccount.findUnique({
      where: { id },
      include: { _count: { select: { transactions: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
    }
    if (existing._count.transactions > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete: this account has ${existing._count.transactions} transaction(s). Delete them first.`,
        },
        { status: 400 }
      )
    }
    await db.bankAccount.delete({ where: { id } })
    return NextResponse.json({ data: { id } })
  } catch (err) {
    console.error('DELETE /api/bank/accounts/[id] failed', err)
    return NextResponse.json({ error: 'Failed to delete bank account' }, { status: 500 })
  }
}

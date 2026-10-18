import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { round2 } from '@/lib/doc-math'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/bank — overview: accounts (+ tx counts), 20 latest transactions,
// balance totals split by account type. Also used as the bank-accounts picker
// source by other modules (payments UI, supplier invoice payments, ...).
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const ctx = await requirePerm('bank.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const accounts = await db.bankAccount.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { transactions: true } } },
    })

    const recentTransactions = await db.bankTransaction.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 20,
      include: {
        account: { select: { id: true, name: true, type: true, currency: true } },
      },
    })

    const bank = round2(
      accounts.filter((a) => a.type === 'BANK').reduce((s, a) => s + a.currentBalance, 0)
    )
    const cash = round2(
      accounts.filter((a) => a.type === 'CASH').reduce((s, a) => s + a.currentBalance, 0)
    )

    return NextResponse.json({
      data: {
        accounts,
        recentTransactions,
        totals: { bank, cash, overall: round2(bank + cash) },
      },
    })
  } catch (err) {
    console.error('GET /api/bank failed', err)
    return NextResponse.json({ error: 'Failed to load bank overview' }, { status: 500 })
  }
}

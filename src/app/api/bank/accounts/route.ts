import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/doc-math'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/bank/accounts — list of accounts with transaction counts
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const accounts = await db.bankAccount.findMany({
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { transactions: true } } },
    })
    return NextResponse.json({ data: accounts })
  } catch (err) {
    console.error('GET /api/bank/accounts failed', err)
    return NextResponse.json({ error: 'Failed to load bank accounts' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/bank/accounts — create. currentBalance starts = openingBalance.
// ---------------------------------------------------------------------------
const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  bank: z.string().trim().max(120).optional().nullable(),
  accountNumber: z.string().trim().max(60).optional().nullable(),
  currency: z.literal('USD').default('USD'),
  type: z.enum(['BANK', 'CASH']).default('BANK'),
  openingBalance: z.coerce.number().min(0, 'Opening balance must be >= 0').default(0),
})

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 }
      )
    }
    const d = parsed.data

    const account = await db.bankAccount.create({
      data: {
        name: d.name,
        bank: d.bank || null,
        accountNumber: d.accountNumber || null,
        currency: 'USD',
        type: d.type,
        openingBalance: round2(d.openingBalance),
        currentBalance: round2(d.openingBalance),
      },
      include: { _count: { select: { transactions: true } } },
    })

    return NextResponse.json({ data: account }, { status: 201 })
  } catch (err) {
    console.error('POST /api/bank/accounts failed', err)
    return NextResponse.json({ error: 'Failed to create bank account' }, { status: 500 })
  }
}

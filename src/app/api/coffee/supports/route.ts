import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/coffee/supports — record a support payment received via KHQR.
// Requires coffee.edit. Powers the supporters wall + total-raised figure.
// ---------------------------------------------------------------------------
const postSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Keep the name under 60 characters'),
  amount: z
    .number({ message: 'Amount must be a number' })
    .positive('Amount must be greater than zero')
    .max(1_000_000_000, 'Amount is too large'),
  currency: z.enum(['USD', 'KHR']),
  message: z.string().trim().max(200, 'Keep the message under 200 characters').nullable().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date (YYYY-MM-DD)')
    .optional(),
})

export async function POST(req: Request) {
  try {
    const ctx = await requirePerm('coffee.edit')
    if (ctx instanceof NextResponse) return ctx

    const body = await req.json().catch(() => null)
    const parsed = postSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid support payload' },
        { status: 400 },
      )
    }
    const { name, amount, currency, message, date } = parsed.data

    const row = await db.coffeeSupport.create({
      data: {
        tenantId: ctx.user.tenantId,
        name,
        amount,
        currency,
        message: message ? message : null,
        // Noon UTC keeps the chosen calendar day stable across timezones.
        date: date ? new Date(`${date}T12:00:00.000Z`) : new Date(),
      },
    })

    return NextResponse.json({ data: row }, { status: 201 })
  } catch (err) {
    console.error('POST /api/coffee/supports failed', err)
    return NextResponse.json({ error: 'Failed to record the support' }, { status: 500 })
  }
}

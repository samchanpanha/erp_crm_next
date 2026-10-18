import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const movementInclude = {
  product: { select: { id: true, ref: true, label: true, unit: true } },
  warehouse: { select: { id: true, name: true, code: true } },
} satisfies Prisma.StockMovementInclude

// ---------------------------------------------------------------------------
// GET /api/stock?productId=&warehouseId=&type= — movements, newest first
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const productId = url.searchParams.get('productId')
    const warehouseId = url.searchParams.get('warehouseId')
    const type = url.searchParams.get('type')

    const where: Prisma.StockMovementWhereInput = {}
    if (productId) where.productId = productId
    if (warehouseId) where.warehouseId = warehouseId
    if (type === 'IN' || type === 'OUT' || type === 'ADJUST') where.type = type

    const movements = await db.stockMovement.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include: movementInclude,
      take: 500,
    })
    return NextResponse.json({ data: movements })
  } catch (err) {
    console.error('GET /api/stock failed', err)
    return NextResponse.json({ error: 'Failed to load stock movements' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/stock — record a movement and update product.stockQty atomically.
// IN -> signed qty positive; OUT -> negative; ADJUST -> as given (±).
// Rejects OUT (or negative ADJUST) that would push stock below zero.
// ---------------------------------------------------------------------------
const createSchema = z.object({
  productId: z.string().trim().min(1, 'Product is required'),
  warehouseId: z.string().trim().max(64).optional().nullable(),
  type: z.enum(['IN', 'OUT', 'ADJUST']),
  qty: z.coerce.number(),
  reference: z.string().trim().max(100).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  date: z.coerce.date().optional(),
})

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 },
      )
    }
    const d = parsed.data

    if (!Number.isInteger(d.qty)) {
      return NextResponse.json({ error: 'Quantity must be a whole number' }, { status: 400 })
    }
    if (d.qty === 0) {
      return NextResponse.json({ error: 'Quantity must not be zero' }, { status: 400 })
    }

    const product = await db.product.findUnique({ where: { id: d.productId } })
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }
    if (!product.manageStock) {
      return NextResponse.json({ error: 'Services cannot have stock movements' }, { status: 400 })
    }

    let signed: number
    if (d.type === 'IN') signed = Math.abs(d.qty)
    else if (d.type === 'OUT') signed = -Math.abs(d.qty)
    else signed = d.qty // ADJUST keeps the given sign

    if (product.stockQty + signed < 0) {
      return NextResponse.json(
        { error: `Insufficient stock (available: ${product.stockQty})` },
        { status: 400 },
      )
    }

    const movement = await db.$transaction(async (tx) => {
      const created = await tx.stockMovement.create({
        data: {
          productId: d.productId,
          warehouseId: d.warehouseId || null,
          type: d.type,
          qty: signed,
          reference: d.reference || null,
          note: d.note || null,
          ...(d.date ? { date: d.date } : {}),
        },
        include: movementInclude,
      })
      await tx.product.update({
        where: { id: d.productId },
        data: { stockQty: { increment: signed } },
      })
      return created
    })

    return NextResponse.json({ data: movement }, { status: 201 })
  } catch (err) {
    console.error('POST /api/stock failed', err)
    return NextResponse.json({ error: 'Failed to record stock movement' }, { status: 500 })
  }
}

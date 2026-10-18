import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/warehouses?q= — list with movement counts
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const ctx = await requirePerm('stock.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim()

    const where: Prisma.WarehouseWhereInput = { tenantId: user.tenantId }
    if (q) {
      where.OR = [{ code: { contains: q } }, { name: { contains: q } }]
    }

    const warehouses = await db.warehouse.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { movements: true } } },
    })
    return NextResponse.json({ data: warehouses })
  } catch (err) {
    console.error('GET /api/warehouses failed', err)
    return NextResponse.json({ error: 'Failed to load warehouses' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/warehouses — create. If isDefault, other warehouses are un-flagged.
// ---------------------------------------------------------------------------
const createSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').max(50),
  name: z.string().trim().min(1, 'Name is required').max(200),
  address: z.string().trim().max(300).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  country: z.string().trim().max(100).optional().nullable(),
  isDefault: z.boolean().default(false),
})

export async function POST(req: Request) {
  try {
    const ctx = await requirePerm('stock.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const body = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 },
      )
    }
    const d = parsed.data

    const warehouse = await db.$transaction(async (tx) => {
      if (d.isDefault) {
        await tx.warehouse.updateMany({
          where: { tenantId: user.tenantId },
          data: { isDefault: false },
        })
      }
      return tx.warehouse.create({
        data: {
          tenantId: user.tenantId,
          code: d.code,
          name: d.name,
          address: d.address || null,
          city: d.city || null,
          country: d.country || null,
          isDefault: d.isDefault,
        },
        include: { _count: { select: { movements: true } } },
      })
    })

    return NextResponse.json({ data: warehouse }, { status: 201 })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'A warehouse with this code already exists' }, { status: 400 })
    }
    console.error('POST /api/warehouses failed', err)
    return NextResponse.json({ error: 'Failed to create warehouse' }, { status: 500 })
  }
}

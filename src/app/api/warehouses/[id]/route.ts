import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').max(50).optional(),
  name: z.string().trim().min(1, 'Name is required').max(200).optional(),
  address: z.string().trim().max(300).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  country: z.string().trim().max(100).optional().nullable(),
  isDefault: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// PUT /api/warehouses/[id]
// ---------------------------------------------------------------------------
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.warehouse.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 },
      )
    }
    const d = parsed.data

    const warehouse = await db.$transaction(async (tx) => {
      // Only one default warehouse at a time
      if (d.isDefault === true) {
        await tx.warehouse.updateMany({
          where: { id: { not: id } },
          data: { isDefault: false },
        })
      }
      return tx.warehouse.update({
        where: { id },
        data: {
          ...(d.code !== undefined && { code: d.code }),
          ...(d.name !== undefined && { name: d.name }),
          ...(d.address !== undefined && { address: d.address || null }),
          ...(d.city !== undefined && { city: d.city || null }),
          ...(d.country !== undefined && { country: d.country || null }),
          ...(d.isDefault !== undefined && { isDefault: d.isDefault }),
        },
        include: { _count: { select: { movements: true } } },
      })
    })

    return NextResponse.json({ data: warehouse })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'A warehouse with this code already exists' }, { status: 400 })
    }
    console.error('PUT /api/warehouses/[id] failed', err)
    return NextResponse.json({ error: 'Failed to update warehouse' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/warehouses/[id] — blocked when the warehouse holds movements
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.warehouse.findUnique({
      where: { id },
      select: { id: true, code: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
    }

    const movementCount = await db.stockMovement.count({ where: { warehouseId: id } })
    if (movementCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete ${existing.code}: ${movementCount} stock movement${movementCount > 1 ? 's' : ''} recorded`,
        },
        { status: 400 },
      )
    }

    await db.warehouse.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/warehouses/[id] failed', err)
    return NextResponse.json({ error: 'Failed to delete warehouse' }, { status: 500 })
  }
}

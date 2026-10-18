import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { nextRef } from '@/lib/refs'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/products?q=&type=&status=&lowStock=1
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim()
    const type = url.searchParams.get('type')
    const status = url.searchParams.get('status')
    const lowStock = url.searchParams.get('lowStock')

    const where: Prisma.ProductWhereInput = {}
    if (q) {
      where.OR = [{ ref: { contains: q } }, { label: { contains: q } }]
    }
    if (type === 'PRODUCT' || type === 'SERVICE') where.type = type
    if (status === 'ACTIVE' || status === 'SUSPENDED') where.status = status

    const products = await db.product.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { ref: 'desc' }],
      include: { _count: { select: { stockMovements: true } } },
    })

    let data = products
    if (lowStock === '1') {
      // SQLite cannot compare two columns in SQL where -> filter in JS
      data = products.filter(
        (p) => p.type === 'PRODUCT' && p.manageStock && p.stockQty <= p.minStock,
      )
    }

    return NextResponse.json({ data })
  } catch (err) {
    console.error('GET /api/products failed', err)
    return NextResponse.json({ error: 'Failed to load products' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/products — create. Ref generated server-side (PDyymm-####).
// stockQty is accepted on CREATE only (initial stock); edits go through /api/stock.
// ---------------------------------------------------------------------------
const createSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(200),
  type: z.enum(['PRODUCT', 'SERVICE']).default('PRODUCT'),
  description: z.string().trim().max(2000).optional().nullable(),
  sellPrice: z.coerce.number().min(0).default(0),
  costPrice: z.coerce.number().min(0).default(0),
  vatRate: z.coerce.number().min(0).max(100).default(20),
  unit: z.string().trim().min(1).max(50).default('unit'),
  barcode: z.string().trim().max(100).optional().nullable(),
  manageStock: z.boolean().optional(),
  stockQty: z.coerce.number().int().min(0).default(0),
  minStock: z.coerce.number().int().min(0).default(0),
  status: z.enum(['ACTIVE', 'SUSPENDED']).default('ACTIVE'),
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
    const manageStock = d.type === 'SERVICE' ? false : d.manageStock ?? true

    // Retry on ref collisions: the shared Sequence counter can lag behind
    // seeded refs, so P2002 on `ref` simply means "try the next number".
    let product: Awaited<ReturnType<typeof db.product.findUniqueOrThrow>> | null = null
    for (let attempt = 0; attempt < 5 && !product; attempt++) {
      try {
        const ref = await nextRef('PD')
        product = await db.product.create({
          data: {
            ref,
            label: d.label,
            description: d.description || null,
            type: d.type,
            sellPrice: d.sellPrice,
            costPrice: d.costPrice,
            vatRate: d.vatRate,
            unit: d.unit,
            barcode: d.barcode || null,
            manageStock,
            stockQty: manageStock ? d.stockQty : 0,
            minStock: manageStock ? d.minStock : 0,
            status: d.status,
          },
          include: { _count: { select: { stockMovements: true } } },
        })
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
        throw e
      }
    }
    if (!product) {
      return NextResponse.json({ error: 'Could not generate a unique product ref' }, { status: 500 })
    }

    // Record the initial stock as a traceable IN movement (delta-consistent:
    // product.stockQty was already initialized with d.stockQty).
    if (manageStock && d.stockQty > 0) {
      const defaultWarehouse = await db.warehouse.findFirst({ where: { isDefault: true } })
      await db.stockMovement.create({
        data: {
          productId: product.id,
          warehouseId: defaultWarehouse?.id ?? null,
          type: 'IN',
          qty: d.stockQty,
          reference: 'INITIAL',
          note: 'Initial stock set on product creation',
        },
      })
      product = await db.product.findUniqueOrThrow({
        where: { id: product.id },
        include: { _count: { select: { stockMovements: true } } },
      })
    }

    return NextResponse.json({ data: product }, { status: 201 })
  } catch (err) {
    console.error('POST /api/products failed', err)
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAuth, requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/coffee/page — coffee page config + support log for this tenant.
// Any signed-in user may read (the module is visible with coffee.view).
// If the tenant never saved a config, defaults are returned (no row created).
// ---------------------------------------------------------------------------
const DEFAULT_PAGE = {
  displayName: 'Buy me a coffee',
  tagline: 'If my work makes your day easier, a coffee is a wonderful thank-you.',
  currency: 'USD',
  presetAmounts: '1,3,5,10',
  khqrImage: null,
  khqrName: null,
  khqrBank: null,
}

export async function GET() {
  try {
    const ctx = await requireAuth()
    if (ctx instanceof NextResponse) return ctx

    const [page, supporters] = await Promise.all([
      db.coffeePage.findUnique({ where: { tenantId: ctx.user.tenantId } }),
      db.coffeeSupport.findMany({
        where: { tenantId: ctx.user.tenantId },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 500,
      }),
    ])

    return NextResponse.json({ data: { page: page ?? DEFAULT_PAGE, supporters } })
  } catch (err) {
    console.error('GET /api/coffee/page failed', err)
    return NextResponse.json({ error: 'Failed to load the coffee page' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PUT /api/coffee/page — partial upsert of the coffee page config.
// Requires coffee.edit. khqrImage carries the uploaded image as a data URL
// (png/jpeg/webp, ~2 MB file → ~2.7 MB base64); sending null clears it.
// ---------------------------------------------------------------------------
const putSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, 'Display name is required')
      .max(80, 'Keep the display name under 80 characters')
      .optional(),
    tagline: z.string().trim().max(200, 'Keep the tagline under 200 characters').optional(),
    currency: z.enum(['USD', 'KHR']).optional(),
    presetAmounts: z
      .string()
      .max(100, 'Too many amounts')
      .regex(/^\d+(\.\d+)?(,\d+(\.\d+)?)*$/, 'Enter comma-separated amounts, e.g. 1,3,5,10')
      .refine(
        (v) => v.split(',').every((p) => Number(p) > 0),
        'Preset amounts must be greater than zero',
      )
      .optional(),
    khqrImage: z
      .string()
      .regex(/^data:image\/(png|jpe?g|webp);base64,/, 'Only PNG, JPG or WebP images are supported')
      .max(3_200_000, 'Image is too large (max 2 MB)')
      .nullable()
      .optional(),
    khqrName: z.string().trim().max(80, 'Keep the account name under 80 characters').nullable().optional(),
    khqrBank: z.string().trim().max(80, 'Keep the bank label under 80 characters').nullable().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, { message: 'Nothing to update' })

export async function PUT(req: Request) {
  try {
    const ctx = await requirePerm('coffee.edit')
    if (ctx instanceof NextResponse) return ctx

    const body = await req.json().catch(() => null)
    const parsed = putSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid coffee page payload' },
        { status: 400 },
      )
    }

    const patch: Record<string, unknown> = { ...parsed.data }
    if (patch.khqrName === '') patch.khqrName = null
    if (patch.khqrBank === '') patch.khqrBank = null

    const page = await db.coffeePage.upsert({
      where: { tenantId: ctx.user.tenantId },
      update: patch,
      create: { tenantId: ctx.user.tenantId, ...patch },
    })

    return NextResponse.json({ data: { page } })
  } catch (err) {
    console.error('PUT /api/coffee/page failed', err)
    return NextResponse.json({ error: 'Failed to save the coffee page' }, { status: 500 })
  }
}

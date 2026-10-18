import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAuth, requirePerm } from '@/lib/auth'
import { seedDocTemplatesForTenant } from '@/lib/doc-template-seed'
import {
  TEMPLATE_TYPES,
  templateConfigSchema,
} from '@/lib/template-schema'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/doc-templates?type= — list (seeds the tenant's starter templates
// on first use). Any signed-in user may read: print dialogs need templates.
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const ctx = await requireAuth()
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    await seedDocTemplatesForTenant(db, user.tenantId)

    const url = new URL(req.url)
    const type = url.searchParams.get('type')
    const where = {
      tenantId: user.tenantId,
      ...(type && (TEMPLATE_TYPES as readonly string[]).includes(type) ? { type } : {}),
    }
    const templates = await db.docTemplate.findMany({
      where,
      orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
    })
    return NextResponse.json({ data: templates })
  } catch (err) {
    console.error('GET /api/doc-templates failed', err)
    return NextResponse.json({ error: 'Failed to load document templates' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/doc-templates — create. If isDefault, unsets others of same type
// (scoped to the tenant). Requires settings.edit.
// ---------------------------------------------------------------------------
const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  type: z.enum(TEMPLATE_TYPES),
  isDefault: z.boolean().default(false),
  config: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: Request) {
  try {
    const ctx = await requirePerm('settings.edit')
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

    // Merge onto defaults so partial configs are accepted
    const config = templateConfigSchema.parse(d.config ?? {})

    const template = await db.$transaction(async (tx) => {
      if (d.isDefault) {
        await tx.docTemplate.updateMany({
          where: { tenantId: user.tenantId, type: d.type },
          data: { isDefault: false },
        })
      }
      return tx.docTemplate.create({
        data: {
          tenantId: user.tenantId,
          name: d.name,
          type: d.type,
          isDefault: d.isDefault,
          config: JSON.stringify(config),
        },
      })
    })

    return NextResponse.json({ data: template }, { status: 201 })
  } catch (err) {
    console.error('POST /api/doc-templates failed', err)
    return NextResponse.json({ error: 'Failed to create document template' }, { status: 500 })
  }
}

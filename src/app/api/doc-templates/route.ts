import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  TEMPLATE_TYPES,
  templateConfigSchema,
  type TemplateType,
} from '@/lib/template-schema'

export const dynamic = 'force-dynamic'

const SEED_NAMES: Record<TemplateType, string> = {
  INVOICE: 'Classic invoice',
  RECEIPT: 'Classic receipt',
  PROPOSAL: 'Classic proposal',
  ORDER: 'Classic sale order',
  SUPPLIER_INVOICE: 'Classic supplier invoice',
}

/** Create one starter template per type on first run. */
async function ensureSeeded() {
  const count = await db.docTemplate.count()
  if (count > 0) return
  await db.docTemplate.createMany({
    data: TEMPLATE_TYPES.map((type) => ({
      name: SEED_NAMES[type],
      type,
      isDefault: true,
      config: JSON.stringify(templateConfigSchema.parse({})),
    })),
  })
}

// ---------------------------------------------------------------------------
// GET /api/doc-templates?type= — list (seeds starter templates when empty)
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    await ensureSeeded()
    const url = new URL(req.url)
    const type = url.searchParams.get('type')
    const templates = await db.docTemplate.findMany({
      where: type && (TEMPLATE_TYPES as readonly string[]).includes(type) ? { type } : undefined,
      orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
    })
    return NextResponse.json({ data: templates })
  } catch (err) {
    console.error('GET /api/doc-templates failed', err)
    return NextResponse.json({ error: 'Failed to load document templates' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/doc-templates — create. If isDefault, unsets others of same type.
// ---------------------------------------------------------------------------
const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  type: z.enum(TEMPLATE_TYPES),
  isDefault: z.boolean().default(false),
  config: z.record(z.string(), z.unknown()).optional(),
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

    // Merge onto defaults so partial configs are accepted
    const config = templateConfigSchema.parse(d.config ?? {})

    const template = await db.$transaction(async (tx) => {
      if (d.isDefault) {
        await tx.docTemplate.updateMany({ where: { type: d.type }, data: { isDefault: false } })
      }
      return tx.docTemplate.create({
        data: {
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

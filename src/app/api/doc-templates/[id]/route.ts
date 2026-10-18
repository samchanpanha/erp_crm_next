import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAuth, requirePerm } from '@/lib/auth'
import { templateConfigSchema } from '@/lib/template-schema'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// GET /api/doc-templates/[id] — any signed-in user (print dialogs read this).
// ---------------------------------------------------------------------------
export async function GET(_req: Request, { params }: Params) {
  try {
    const ctx = await requireAuth()
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const template = await db.docTemplate.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    return NextResponse.json({ data: template })
  } catch (err) {
    console.error('GET /api/doc-templates/[id] failed', err)
    return NextResponse.json({ error: 'Failed to load template' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PUT /api/doc-templates/[id] — update name / isDefault / config (partial OK).
// The "unset other defaults of same type" sweep is scoped to the tenant.
// Requires settings.edit.
// ---------------------------------------------------------------------------
const putSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  isDefault: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

export async function PUT(req: Request, { params }: Params) {
  try {
    const ctx = await requirePerm('settings.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.docTemplate.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

    const body = await req.json().catch(() => null)
    const parsed = putSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 },
      )
    }
    const d = parsed.data

    const config = d.config
      ? JSON.stringify(templateConfigSchema.parse({ ...JSON.parse(existing.config), ...d.config }))
      : existing.config

    const template = await db.$transaction(async (tx) => {
      if (d.isDefault) {
        await tx.docTemplate.updateMany({
          where: { tenantId: user.tenantId, type: existing.type, id: { not: id } },
          data: { isDefault: false },
        })
      }
      return tx.docTemplate.update({
        where: { id },
        data: {
          ...(d.name !== undefined ? { name: d.name } : {}),
          ...(d.isDefault !== undefined ? { isDefault: d.isDefault } : {}),
          config,
        },
      })
    })

    return NextResponse.json({ data: template })
  } catch (err) {
    console.error('PUT /api/doc-templates/[id] failed', err)
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/doc-templates/[id] — requires settings.edit.
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const ctx = await requirePerm('settings.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.docTemplate.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    await db.docTemplate.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/doc-templates/[id] failed', err)
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}

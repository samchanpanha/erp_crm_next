import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const KB_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const

const updateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title is too long').optional(),
  category: z.preprocess(
    (v) => {
      if (v === undefined) return undefined
      if (v === null || (typeof v === 'string' && v.trim() === '')) return 'General'
      return v
    },
    z.string().trim().max(80, 'Category is too long').optional(),
  ),
  content: z
    .string()
    .trim()
    .min(1, 'Content is required')
    .max(20000, 'Content is too long')
    .optional(),
  status: z.enum(KB_STATUSES).optional(),
})

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

// ---------------------------------------------------------------------------
// GET /api/knowledge/:id → { data: KnowledgeArticle }
// Counts a view: every read bumps the `views` counter (server-side).
// ---------------------------------------------------------------------------
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('knowledge.view')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.knowledgeArticle.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!existing) return bad('Article not found', 404)

    const article = await db.knowledgeArticle.update({
      where: { id },
      data: { views: { increment: 1 } },
    })

    return NextResponse.json({ data: article })
  } catch (err) {
    console.error('GET /api/knowledge/[id] failed', err)
    return bad('Failed to load article', 500)
  }
}

// ---------------------------------------------------------------------------
// PUT /api/knowledge/:id → { data: KnowledgeArticle }
// ---------------------------------------------------------------------------
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('knowledge.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.knowledgeArticle.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!existing) return bad('Article not found', 404)

    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))

    const sentCount = Object.values(parsed.data).filter((v) => v !== undefined).length
    if (sentCount === 0) return bad('No fields to update')

    const updated = await db.knowledgeArticle.update({
      where: { id },
      data: parsed.data,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/knowledge/[id] failed', err)
    return bad('Failed to update article', 500)
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/knowledge/:id → { data: { ok: true } }
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('knowledge.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const existing = await db.knowledgeArticle.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!existing) return bad('Article not found', 404)

    await db.knowledgeArticle.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/knowledge/[id] failed', err)
    return bad('Failed to delete article', 500)
  }
}

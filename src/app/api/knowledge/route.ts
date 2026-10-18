import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const KB_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const
type KbStatus = (typeof KB_STATUSES)[number]

const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title is too long'),
  category: z.preprocess(
    (v) => {
      if (v === undefined || v === null || (typeof v === 'string' && v.trim() === ''))
        return 'General'
      return v
    },
    z.string().trim().max(80, 'Category is too long'),
  ),
  content: z
    .string()
    .trim()
    .min(1, 'Content is required')
    .max(20000, 'Content is too long'),
  status: z.enum(KB_STATUSES).default('DRAFT'),
})

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

// ---------------------------------------------------------------------------
// GET /api/knowledge?q=&status=&category= → { data: KnowledgeArticle[] }
// Sorted by updatedAt desc. `q` searches title + plain-text content.
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim() ?? ''
    const status = searchParams.get('status')?.trim() ?? ''
    const category = searchParams.get('category')?.trim() ?? ''

    const where: {
      status?: KbStatus
      category?: string
      OR?: ({ title: { contains: string } } | { content: { contains: string } })[]
    } = {}

    if ((KB_STATUSES as readonly string[]).includes(status)) where.status = status as KbStatus
    if (category) where.category = category
    if (q) where.OR = [{ title: { contains: q } }, { content: { contains: q } }]

    const list = await db.knowledgeArticle.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    })

    return NextResponse.json({ data: list })
  } catch (err) {
    console.error('GET /api/knowledge failed', err)
    return bad('Failed to load knowledge base', 500)
  }
}

// ---------------------------------------------------------------------------
// POST /api/knowledge → 201 { data: KnowledgeArticle }
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))

    const created = await db.knowledgeArticle.create({ data: parsed.data })

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/knowledge failed', err)
    return bad('Failed to create article', 500)
  }
}

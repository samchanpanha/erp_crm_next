import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/sequences — read-only view of document counters.
// value = last used number; the next generated ref will use value + 1.
// Sequence rows are per-tenant (key = "<tenantId>:<prefix>"); the tenant
// prefix is stripped here so the Settings UI keeps showing bare prefixes.
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const ctx = await requireAuth()
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const rows = await db.sequence.findMany({
      where: { key: { startsWith: user.tenantId + ':' } },
      orderBy: { key: 'asc' },
    })
    const prefix = user.tenantId + ':'
    return NextResponse.json({
      data: rows.map((r) => ({ key: r.key.startsWith(prefix) ? r.key.slice(prefix.length) : r.key, value: r.value })),
    })
  } catch (err) {
    console.error('GET /api/sequences failed', err)
    return NextResponse.json({ error: 'Failed to load document sequences' }, { status: 500 })
  }
}

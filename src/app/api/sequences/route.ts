import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/sequences — read-only view of document counters.
// value = last used number; the next generated ref will use value + 1.
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const rows = await db.sequence.findMany({ orderBy: { key: 'asc' } })
    return NextResponse.json({
      data: rows.map((r) => ({ key: r.key, value: r.value })),
    })
  } catch (err) {
    console.error('GET /api/sequences failed', err)
    return NextResponse.json({ error: 'Failed to load document sequences' }, { status: 500 })
  }
}

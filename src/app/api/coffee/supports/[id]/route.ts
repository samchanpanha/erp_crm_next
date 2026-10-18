import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// DELETE /api/coffee/supports/[id] — remove a support log entry.
// Requires coffee.edit; tenant-scoped (cross-tenant ids → 404).
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('coffee.edit')
    if (ctx instanceof NextResponse) return ctx

    const { id } = await params
    const row = await db.coffeeSupport.findFirst({
      where: { id, tenantId: ctx.user.tenantId },
    })
    if (!row) {
      return NextResponse.json({ error: 'Support entry not found' }, { status: 404 })
    }

    await db.coffeeSupport.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/coffee/supports/[id] failed', err)
    return NextResponse.json({ error: 'Failed to delete the support entry' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

// /api/coffee/image-url — the "Buy me a coffee" KHQR image as a MANUAL URL.
//
// No upload endpoint: the super administrator simply pastes a direct image
// URL (https://…) or a path to a file dropped into /public (e.g. /khqr.png).
// The URL is stored per-tenant in the Setting table under 'coffee.khqrImageUrl'
// (invisible to the Settings UI, which whitelists known keys only).
//   GET — any signed-in user: { khqrUrl: string | null }
//   PUT — super administrator only: { url: string | null } (null clears it)

const KEY = 'coffee.khqrImageUrl'

async function readKhqrUrl(tenantId: string): Promise<string | null> {
  const row = await db.setting.findUnique({
    where: { tenantId_key: { tenantId, key: KEY } },
  })
  return row?.value || null
}

export async function GET() {
  const ctx = await requireAuth()
  if (ctx instanceof NextResponse) return ctx
  try {
    return NextResponse.json({ data: { khqrUrl: await readKhqrUrl(ctx.user.tenantId) } })
  } catch (err) {
    console.error('GET /api/coffee/image-url failed', err)
    return NextResponse.json({ error: 'Failed to load the KHQR image URL' }, { status: 500 })
  }
}

const putSchema = z.object({
  url: z
    .string()
    .trim()
    .max(1000, 'Keep the URL under 1000 characters')
    .regex(/^(https?:\/\/|\/)/i, 'Enter a direct image URL starting with https:// (or a /path to a file in /public)')
    .nullable(),
})

export async function PUT(request: Request) {
  const ctx = await requireAuth()
  if (ctx instanceof NextResponse) return ctx
  if (!isSuperAdmin(ctx.user.permissions)) {
    return NextResponse.json(
      { error: 'Only the super administrator can change the KHQR image URL.' },
      { status: 403 },
    )
  }
  try {
    const body = await request.json().catch(() => null)
    const parsed = putSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 },
      )
    }
    const url = parsed.data.url || null
    if (url) {
      await db.setting.upsert({
        where: { tenantId_key: { tenantId: ctx.user.tenantId, key: KEY } },
        update: { value: url },
        create: { tenantId: ctx.user.tenantId, key: KEY, value: url },
      })
    } else {
      await db.setting.deleteMany({
        where: { tenantId: ctx.user.tenantId, key: KEY },
      })
    }
    return NextResponse.json({ data: { khqrUrl: url } })
  } catch (err) {
    console.error('PUT /api/coffee/image-url failed', err)
    return NextResponse.json({ error: 'Failed to save the KHQR image URL' }, { status: 500 })
  }
}

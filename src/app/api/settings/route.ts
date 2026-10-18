import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { SETTING_DEFAULTS } from '@/lib/template-schema'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/settings — merged settings map (defaults overlaid by stored values)
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const rows = await db.setting.findMany()
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    return NextResponse.json({ data: { ...SETTING_DEFAULTS, ...stored } })
  } catch (err) {
    console.error('GET /api/settings failed', err)
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PUT /api/settings — upsert a patch of settings. Returns the merged map.
// ---------------------------------------------------------------------------
const putSchema = z.record(z.string().min(1).max(100), z.string().max(2_000_000))

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = putSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid settings payload' },
        { status: 400 },
      )
    }
    const patch = parsed.data
    const unknown = Object.keys(patch).filter((k) => !(k in SETTING_DEFAULTS))
    if (unknown.length > 0) {
      return NextResponse.json({ error: `Unknown setting keys: ${unknown.join(', ')}` }, { status: 400 })
    }

    await db.$transaction(
      Object.entries(patch).map(([key, value]) =>
        db.setting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        }),
      ),
    )

    const rows = await db.setting.findMany()
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    return NextResponse.json({ data: { ...SETTING_DEFAULTS, ...stored } })
  } catch (err) {
    console.error('PUT /api/settings failed', err)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}

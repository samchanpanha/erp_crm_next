import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/auth/me — current session user (401 when signed out).
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }
    return NextResponse.json({ data: { user } })
  } catch (err) {
    console.error('GET /api/auth/me failed', err)
    return NextResponse.json({ error: 'Failed to load session' }, { status: 500 })
  }
}

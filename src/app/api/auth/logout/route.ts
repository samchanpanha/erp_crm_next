import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { SESSION_COOKIE, clearSessionCookie } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/auth/logout — delete the session row + clear the cookie.
// ---------------------------------------------------------------------------
export async function POST() {
  try {
    const jar = await cookies()
    const token = jar.get(SESSION_COOKIE)?.value
    if (token) {
      await db.session.deleteMany({ where: { id: token } })
    }
  } catch (err) {
    console.error('POST /api/auth/logout failed', err)
  }
  const res = NextResponse.json({ data: { ok: true } })
  return clearSessionCookie(res)
}

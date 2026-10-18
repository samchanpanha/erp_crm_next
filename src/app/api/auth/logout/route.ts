import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { SESSION_COOKIE, clearSessionCookie } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/auth/logout — delete the session row + clear the cookie.
// Accepts the session token via the Authorization: Bearer header (iframe-safe
// transport) or the session cookie (same-site tabs).
// ---------------------------------------------------------------------------
export async function POST() {
  try {
    const h = await headers()
    const jar = await cookies()

    const auth = h.get('authorization')
    const bearer = auth?.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : null
    const cookieToken = jar.get(SESSION_COOKIE)?.value ?? null

    const tokens = [...new Set([bearer, cookieToken].filter((t): t is string => Boolean(t)))]
    if (tokens.length > 0) {
      await db.session.deleteMany({ where: { id: { in: tokens } } })
    }
  } catch (err) {
    console.error('POST /api/auth/logout failed', err)
  }
  const res = NextResponse.json({ data: { ok: true } })
  return clearSessionCookie(res)
}

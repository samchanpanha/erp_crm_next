import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { buildUserPayload, createSession, setSessionCookie } from '@/lib/auth'
import { verifyPassword } from '@/lib/password'

export const dynamic = 'force-dynamic'

const loginSchema = z.object({
  email: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.email('Invalid email address').max(200),
  ),
  password: z.string().min(1, 'Password is required'),
})

// ---------------------------------------------------------------------------
// POST /api/auth/login — verify credentials, create a session, set cookie.
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 },
      )
    }
    const { email, password } = parsed.data

    const user = await db.user.findUnique({
      where: { email },
      include: { role: true, tenant: true },
    })
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
    }
    if (user.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'This account has been disabled. Contact your administrator.' },
        { status: 403 },
      )
    }

    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    const { token, expiresAt } = await createSession(user.id)
    const res = NextResponse.json({ data: { user: buildUserPayload(user) } })
    return setSessionCookie(res, token, expiresAt)
  } catch (err) {
    console.error('POST /api/auth/login failed', err)
    return NextResponse.json({ error: 'Sign in failed. Please try again.' }, { status: 500 })
  }
}

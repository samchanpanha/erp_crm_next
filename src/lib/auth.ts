import { cookies, headers } from 'next/headers'
import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hasPerm } from '@/lib/permissions'

/**
 * Server-side auth core: session cookie + request guards.
 * Sessions are opaque random tokens stored in the Session table (30-day TTL).
 */

export const SESSION_COOKIE = 'dolinext_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface SessionRole {
  id: string
  name: string
  permissions: string[]
  isSystem: boolean
}

export interface SessionUser {
  id: string
  tenantId: string
  email: string
  name: string
  status: string
  role: SessionRole | null
  tenant: { id: string; name: string }
  /** Flattened permission strings of the role (["*"] = Administrator). */
  permissions: string[]
}

type DbUserWithRelations = {
  id: string
  tenantId: string
  email: string
  name: string
  status: string
  role: { id: string; name: string; permissions: string; isSystem: boolean } | null
  tenant: { id: string; name: string }
}

export function buildUserPayload(user: DbUserWithRelations): SessionUser {
  const permissions = user.role ? (JSON.parse(user.role.permissions || '[]') as string[]) : []
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    status: user.status,
    role: user.role
      ? { id: user.role.id, name: user.role.name, permissions, isSystem: user.role.isSystem }
      : null,
    tenant: { id: user.tenant.id, name: user.tenant.name },
    permissions,
  }
}

/**
 * Extract the session token from the incoming request.
 * Priority: `Authorization: Bearer <token>` header → session cookie.
 *
 * The header matters because the preview panel embeds the app in a cross-site
 * iframe where browsers block SameSite=Lax cookies; the client then transports
 * the token via the Authorization header instead.
 */
export async function getSessionToken(): Promise<string | null> {
  const h = await headers()
  const auth = h.get('authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim()
    if (token) return token
  }
  const jar = await cookies()
  return jar.get(SESSION_COOKIE)?.value ?? null
}

/** Read the session token (header or cookie) and resolve the logged-in user (or null). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = await getSessionToken()
  if (!token) return null

  const session = await db.session.findUnique({
    where: { id: token },
    include: { user: { include: { role: true, tenant: true } } },
  })
  if (!session) return null

  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: token } }).catch(() => undefined)
    return null
  }
  if (session.user.status !== 'ACTIVE') return null

  return buildUserPayload(session.user)
}

export type AuthContext = { user: SessionUser }

/**
 * 401 guard. Usage:
 *   const ctx = await requireAuth()
 *   if (ctx instanceof NextResponse) return ctx
 *   // ctx.user is SessionUser
 */
export async function requireAuth(): Promise<AuthContext | NextResponse> {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'Authentication required. Please sign in.' }, { status: 401 })
  }
  return { user }
}

/**
 * 401 + 403 guard for a specific permission ("<module>.<action>").
 * Same usage pattern as requireAuth().
 */
export async function requirePerm(needed: string): Promise<AuthContext | NextResponse> {
  const ctx = await requireAuth()
  if (ctx instanceof NextResponse) return ctx
  if (!hasPerm(ctx.user.permissions, needed)) {
    return NextResponse.json(
      { error: 'You do not have permission to perform this action.' },
      { status: 403 },
    )
  }
  return ctx
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.session.create({ data: { id: token, userId, expiresAt } })
  return { token, expiresAt }
}

/** Attach the session cookie to a response. secure=false: sandbox preview serves plain http. */
export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
  return res
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
}

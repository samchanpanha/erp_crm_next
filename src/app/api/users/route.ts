import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { hashPassword } from '@/lib/password'

export const dynamic = 'force-dynamic'

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

/** Prisma P2002 = unique-constraint violation (User.email is globally unique) */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

const emailSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.email('Invalid email address').max(200, 'Email is too long'),
)

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120, 'Name is too long'),
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters').max(200, 'Password is too long'),
  roleId: z.string().min(1, 'Please select a role'),
})

/**
 * Wire format for a user row — never exposes passwordHash.
 * role is null when the user has no role assigned.
 */
function serializeUser(user: {
  id: string
  name: string
  email: string
  status: string
  roleId: string | null
  role: { id: string; name: string; isSystem: boolean } | null
  lastLoginAt: Date | null
  createdAt: Date
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    roleId: user.roleId,
    role: user.role
      ? { id: user.role.id, name: user.role.name, isSystem: user.role.isSystem }
      : null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  }
}

// ---------------------------------------------------------------------------
// GET /api/users → { data: User[] } (tenant-scoped, oldest first)
// ---------------------------------------------------------------------------
export async function GET() {
  const ctx = await requirePerm('administration.view')
  if (ctx instanceof NextResponse) return ctx

  try {
    const users = await db.user.findMany({
      where: { tenantId: ctx.user.tenantId },
      orderBy: { createdAt: 'asc' },
      include: { role: true },
    })
    return NextResponse.json({ data: users.map(serializeUser) })
  } catch (err) {
    console.error('GET /api/users failed', err)
    return bad('Failed to load users', 500)
  }
}

// ---------------------------------------------------------------------------
// POST /api/users → 201 { data: User }
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  const ctx = await requirePerm('administration.edit')
  if (ctx instanceof NextResponse) return ctx

  try {
    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))
    const { name, email, password, roleId } = parsed.data

    const role = await db.role.findFirst({ where: { id: roleId, tenantId: ctx.user.tenantId } })
    if (!role) return bad('Selected role not found')

    try {
      const created = await db.user.create({
        data: {
          tenantId: ctx.user.tenantId,
          name,
          email,
          passwordHash: hashPassword(password),
          roleId,
        },
        include: { role: true },
      })
      return NextResponse.json({ data: serializeUser(created) }, { status: 201 })
    } catch (createErr) {
      if (isUniqueViolation(createErr)) {
        return bad('An account with this email already exists', 409)
      }
      throw createErr
    }
  } catch (err) {
    console.error('POST /api/users failed', err)
    return bad('Failed to create user', 500)
  }
}

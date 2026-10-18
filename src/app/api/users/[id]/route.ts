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

const updateSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120, 'Name is too long').optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200, 'Password is too long').optional(),
  roleId: z.string().min(1, 'Please select a role').optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
})

/** Drop undefined keys so Prisma only updates what was sent */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

/** Wire format for a user row — never exposes passwordHash. */
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
// PUT /api/users/:id → { data: User }  (partial update, tenant-scoped)
// Guards: self (role/status), last active administrator.
// ---------------------------------------------------------------------------
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePerm('administration.edit')
  if (ctx instanceof NextResponse) return ctx

  try {
    const { id } = await params
    const target = await db.user.findFirst({
      where: { id, tenantId: ctx.user.tenantId },
      include: { role: true },
    })
    if (!target) return bad('User not found', 404)

    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))
    const data = stripUndefined(parsed.data)
    if (Object.keys(data).length === 0) return bad('No fields to update')

    // Self-guard: you may rename yourself / change your own password, but not
    // your own role or status (that could lock you out or escalate privileges).
    if (target.id === ctx.user.id && (data.roleId !== undefined || data.status !== undefined)) {
      return bad('You cannot change your own role or status')
    }

    // Last-admin guard: an ACTIVE user on the "Administrator" role cannot lose
    // that status (disable / demote / delete) while no OTHER active
    // administrator remains in the tenant.
    const removesAdmin =
      target.status === 'ACTIVE' &&
      target.role?.name === 'Administrator' &&
      ((data.status !== undefined && data.status === 'DISABLED') ||
        (data.roleId !== undefined && data.roleId !== target.roleId))

    if (removesAdmin) {
      const otherActiveAdmins = await db.user.count({
        where: {
          tenantId: ctx.user.tenantId,
          id: { not: target.id },
          status: 'ACTIVE',
          role: { name: 'Administrator' },
        },
      })
      if (otherActiveAdmins === 0) return bad('This is the last administrator account')
    }

    if (data.roleId !== undefined && data.roleId !== target.roleId) {
      const role = await db.role.findFirst({
        where: { id: data.roleId, tenantId: ctx.user.tenantId },
      })
      if (!role) return bad('Selected role not found')
    }

    const update: Record<string, unknown> = { ...data }
    if (typeof update.password === 'string') {
      update.passwordHash = hashPassword(update.password)
      delete update.password
    }

    const updated = await db.user.update({
      where: { id: target.id },
      data: update,
      include: { role: true },
    })
    return NextResponse.json({ data: serializeUser(updated) })
  } catch (err) {
    console.error('PUT /api/users/[id] failed', err)
    return bad('Failed to update user', 500)
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/users/:id → { data: { ok: true } }
// Guards: cannot delete self, cannot delete the last active administrator.
// Removes the user's sessions first so deleted accounts are signed out.
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePerm('administration.edit')
  if (ctx instanceof NextResponse) return ctx

  try {
    const { id } = await params
    const target = await db.user.findFirst({
      where: { id, tenantId: ctx.user.tenantId },
      include: { role: true },
    })
    if (!target) return bad('User not found', 404)

    if (target.id === ctx.user.id) return bad('You cannot delete your own account')

    const removesAdmin =
      target.status === 'ACTIVE' && target.role?.name === 'Administrator'

    if (removesAdmin) {
      const otherActiveAdmins = await db.user.count({
        where: {
          tenantId: ctx.user.tenantId,
          id: { not: target.id },
          status: 'ACTIVE',
          role: { name: 'Administrator' },
        },
      })
      if (otherActiveAdmins === 0) return bad('This is the last administrator account')
    }

    await db.session.deleteMany({ where: { userId: target.id } })
    await db.user.delete({ where: { id: target.id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/users/[id] failed', err)
    return bad('Failed to delete user', 500)
  }
}

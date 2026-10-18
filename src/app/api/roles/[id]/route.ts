import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

/** Prisma P2002 = unique-constraint violation (@@unique([tenantId, name])) */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

/** "<module>.<view|edit>" strings or the "*" wildcard; max 100 entries. */
const permissionsSchema = z
  .array(z.string().regex(/^\*$|^[a-z]+\.(view|edit)$/, 'Invalid permission string'))
  .max(100, 'Too many permissions')

const descriptionSchema = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return null
    if (typeof v === 'string') {
      const t = v.trim()
      return t.length ? t : null
    }
    return v
  },
  z.string().max(300, 'Description is too long').nullable(),
)

const updateSchema = z.object({
  name: z.string().trim().min(2, 'Role name must be at least 2 characters').max(60, 'Role name is too long').optional(),
  description: descriptionSchema.optional(),
  permissions: permissionsSchema.optional(),
})

/** Drop undefined keys so Prisma only updates what was sent */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

/** Wire format for a role row: permissions JSON-parsed to a string[]. */
function serializeRole(role: {
  id: string
  name: string
  description: string | null
  permissions: string
  isSystem: boolean
  createdAt: Date
  _count?: { users: number }
}) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: JSON.parse(role.permissions || '[]') as string[],
    isSystem: role.isSystem,
    userCount: role._count?.users ?? 0,
    createdAt: role.createdAt,
  }
}

// ---------------------------------------------------------------------------
// PUT /api/roles/:id → { data: Role }
// System roles: only `permissions` may change (Administrator fully locked).
// Custom roles: name / description / permissions all editable.
// ---------------------------------------------------------------------------
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePerm('administration.edit')
  if (ctx instanceof NextResponse) return ctx

  try {
    const { id } = await params
    const target = await db.role.findFirst({
      where: { id, tenantId: ctx.user.tenantId },
      include: { _count: { select: { users: true } } },
    })
    if (!target) return bad('Role not found', 404)

    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))
    const data = stripUndefined(parsed.data)
    if (Object.keys(data).length === 0) return bad('No fields to update')

    if (target.isSystem) {
      if (target.name === 'Administrator') {
        return bad('The Administrator role cannot be modified')
      }
      if (data.name !== undefined && data.name !== target.name) {
        return bad('System role names cannot be changed')
      }
      if (data.description !== undefined && data.description !== target.description) {
        return bad('System role descriptions cannot be changed')
      }
    }

    const update: Record<string, unknown> = { ...data }
    if (Array.isArray(update.permissions)) {
      update.permissions = JSON.stringify(update.permissions)
    }

    try {
      const updated = await db.role.update({
        where: { id: target.id },
        data: update,
        include: { _count: { select: { users: true } } },
      })
      return NextResponse.json({ data: serializeRole(updated) })
    } catch (updateErr) {
      if (isUniqueViolation(updateErr)) {
        return bad('A role with this name already exists')
      }
      throw updateErr
    }
  } catch (err) {
    console.error('PUT /api/roles/[id] failed', err)
    return bad('Failed to update role', 500)
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/roles/:id → { data: { ok: true } }
// System roles can never be deleted; custom roles must have no users.
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePerm('administration.edit')
  if (ctx instanceof NextResponse) return ctx

  try {
    const { id } = await params
    const target = await db.role.findFirst({
      where: { id, tenantId: ctx.user.tenantId },
      include: { _count: { select: { users: true } } },
    })
    if (!target) return bad('Role not found', 404)

    if (target.isSystem) return bad('System roles cannot be deleted')
    if (target._count.users > 0) {
      return bad('Reassign its users before deleting this role')
    }

    await db.role.delete({ where: { id: target.id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/roles/[id] failed', err)
    return bad('Failed to delete role', 500)
  }
}

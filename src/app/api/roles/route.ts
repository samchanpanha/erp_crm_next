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

const createSchema = z.object({
  name: z.string().trim().min(2, 'Role name must be at least 2 characters').max(60, 'Role name is too long'),
  description: z.preprocess(
    (v) => {
      if (v === undefined || v === null) return null
      if (typeof v === 'string') {
        const t = v.trim()
        return t.length ? t : null
      }
      return v
    },
    z.string().max(300, 'Description is too long').nullable(),
  ),
  permissions: permissionsSchema,
})

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
// GET /api/roles → { data: Role[] } (system roles first, then by name)
// ---------------------------------------------------------------------------
export async function GET() {
  const ctx = await requirePerm('administration.view')
  if (ctx instanceof NextResponse) return ctx

  try {
    const roles = await db.role.findMany({
      where: { tenantId: ctx.user.tenantId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { users: true } } },
    })
    return NextResponse.json({ data: roles.map(serializeRole) })
  } catch (err) {
    console.error('GET /api/roles failed', err)
    return bad('Failed to load roles', 500)
  }
}

// ---------------------------------------------------------------------------
// POST /api/roles → 201 { data: Role }
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  const ctx = await requirePerm('administration.edit')
  if (ctx instanceof NextResponse) return ctx

  try {
    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))
    const { name, description, permissions } = parsed.data

    try {
      const created = await db.role.create({
        data: {
          tenantId: ctx.user.tenantId,
          name,
          description,
          permissions: JSON.stringify(permissions),
          isSystem: false,
        },
        include: { _count: { select: { users: true } } },
      })
      return NextResponse.json({ data: serializeRole(created) }, { status: 201 })
    } catch (createErr) {
      if (isUniqueViolation(createErr)) {
        return bad('A role with this name already exists')
      }
      throw createErr
    }
  } catch (err) {
    console.error('POST /api/roles failed', err)
    return bad('Failed to create role', 500)
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { db } from '@/lib/db'
import { buildUserPayload, createSession, setSessionCookie } from '@/lib/auth'
import { hashPassword } from '@/lib/password'
import { SYSTEM_ROLE_DEFS } from '@/lib/permissions'
import { seedDocTemplatesForTenant } from '@/lib/doc-template-seed'

export const dynamic = 'force-dynamic'

const emailSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.email('Invalid email address').max(200),
)

const registerSchema = z.object({
  organization: z.string().trim().min(2, 'Organization name is too short').max(120),
  name: z.string().trim().min(2, 'Please enter your full name').max(120),
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
})

// ---------------------------------------------------------------------------
// POST /api/auth/register — create a new tenant + Administrator user,
// seed the 5 system roles and starter document templates, then sign in.
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 },
      )
    }
    const { organization, name, email, password } = parsed.data

    const existing = await db.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Try signing in instead.' },
        { status: 409 },
      )
    }

    const user = await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: organization } })

      const roles: Role[] = []
      for (const def of SYSTEM_ROLE_DEFS) {
        roles.push(
          await tx.role.create({
            data: {
              tenantId: tenant.id,
              name: def.name,
              description: def.description,
              permissions: JSON.stringify(def.permissions),
              isSystem: true,
            },
          }),
        )
      }
      const adminRole = roles.find((r) => r.name === 'Administrator')
      if (!adminRole) throw new Error('System roles missing after seeding')

      const created = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          name,
          passwordHash: hashPassword(password),
          roleId: adminRole.id,
        },
        include: { role: true, tenant: true },
      })

      await seedDocTemplatesForTenant(tx, tenant.id)
      return created
    })

    const { token, expiresAt } = await createSession(user.id)
    const res = NextResponse.json(
      { data: { user: buildUserPayload(user), token, expiresAt } },
      { status: 201 },
    )
    return setSessionCookie(res, token, expiresAt)
  } catch (err) {
    console.error('POST /api/auth/register failed', err)
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 })
  }
}

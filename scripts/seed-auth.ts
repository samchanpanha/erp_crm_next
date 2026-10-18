/**
 * Auth/tenancy bootstrap seed.
 * Run with: bun scripts/seed-auth.ts
 *
 * 1. Creates the fixed "t_demo" tenant (pre-existing rows default to tenantId="t_demo").
 * 2. Migrates global Sequence keys to per-tenant keys ("t_demo:<prefix>").
 * 3. Seeds the 5 system roles for the demo tenant.
 * 4. Creates demo users (password: demo123).
 * 5. Seeds starter document templates for the demo tenant.
 */
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/password'
import { SYSTEM_ROLE_DEFS } from '../src/lib/permissions'
import { seedDocTemplatesForTenant } from '../src/lib/doc-template-seed'

const db = new PrismaClient()

const DEMO_TENANT_ID = 't_demo'

const DEMO_USERS = [
  { email: 'admin@dolinext.com', name: 'Demo Admin', role: 'Administrator' },
  { email: 'sarah@dolinext.com', name: 'Sarah Cooper', role: 'Sales' },
  { email: 'dan@dolinext.com', name: 'Dan Reeves', role: 'Accountant' },
]

async function main() {
  // 1. Demo tenant with the fixed id that pre-existing rows reference
  await db.tenant.upsert({
    where: { id: DEMO_TENANT_ID },
    update: {},
    create: { id: DEMO_TENANT_ID, name: 'Demo Organization' },
  })

  // 2. Migrate global sequence counters to tenant-scoped keys
  const migrated = await db.$executeRawUnsafe(
    `UPDATE "Sequence" SET key = '${DEMO_TENANT_ID}:' || key WHERE key NOT LIKE '%:%'`,
  )

  // 3. System roles for the demo tenant
  const roleIds = new Map<string, string>()
  for (const def of SYSTEM_ROLE_DEFS) {
    const existing = await db.role.findFirst({
      where: { tenantId: DEMO_TENANT_ID, name: def.name },
    })
    const role =
      existing ??
      (await db.role.create({
        data: {
          tenantId: DEMO_TENANT_ID,
          name: def.name,
          description: def.description,
          permissions: JSON.stringify(def.permissions),
          isSystem: true,
        },
      }))
    roleIds.set(def.name, role.id)
  }

  // 4. Demo users
  for (const u of DEMO_USERS) {
    const roleId = roleIds.get(u.role)
    if (!roleId) throw new Error(`Role not seeded: ${u.role}`)
    await db.user.upsert({
      where: { email: u.email },
      update: { tenantId: DEMO_TENANT_ID, roleId, status: 'ACTIVE' },
      create: {
        tenantId: DEMO_TENANT_ID,
        email: u.email,
        name: u.name,
        passwordHash: hashPassword('demo123'),
        roleId,
      },
    })
  }

  // 5. Starter document templates for the demo tenant
  await seedDocTemplatesForTenant(db, DEMO_TENANT_ID)

  console.log(
    `[seed-auth] tenant="${DEMO_TENANT_ID}" sequenceKeysMigrated=${migrated} ` +
      `roles=[${[...roleIds.keys()].join(', ')}] users=${DEMO_USERS.map((u) => u.email).join(', ')}`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())

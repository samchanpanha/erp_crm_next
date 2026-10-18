// One-off migration for "KHQR = super-administrator's own upload only":
//  1) Clears demo/placeholder KHQR images + account/bank labels so the coffee
//     page only ever shows an image the super administrator uploaded.
//  2) Strips coffee.edit from every role that does not hold the "*" wildcard —
//     from now on only the Administrator (super admin) owns the coffee page.
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  // 1) Clear placeholder KHQR payloads
  const cleared = await db.coffeePage.updateMany({
    data: { khqrImage: null, khqrName: null, khqrBank: null },
  })
  console.log(`- coffeePage rows cleared of placeholder KHQR: ${cleared.count}`)

  // 2) coffee.edit → super administrators only
  const roles = await db.role.findMany()
  for (const role of roles) {
    const perms: string[] = JSON.parse(role.permissions || '[]')
    if (perms.includes('*')) continue
    if (perms.includes('coffee.edit')) {
      await db.role.update({
        where: { id: role.id },
        data: { permissions: JSON.stringify(perms.filter((p) => p !== 'coffee.edit')) },
      })
      console.log(`- role "${role.name}" (${role.tenantId}): removed coffee.edit`)
    }
  }
  console.log('Done.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())

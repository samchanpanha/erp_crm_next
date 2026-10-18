// One-off migration: grant coffee.view / coffee.edit to seeded system roles
// created before the "Buy me a coffee" module existed. Append-only — never
// removes permissions. Administrator ("*") needs nothing.
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const roles = await db.role.findMany({ where: { isSystem: true } })
  for (const role of roles) {
    const perms: string[] = JSON.parse(role.permissions || '[]')
    if (perms.includes('*')) {
      console.log(`- ${role.name}: wildcard, nothing to do`)
      continue
    }
    const add: string[] = []
    if (!perms.includes('coffee.view')) add.push('coffee.view')
    if (role.name === 'Manager' && !perms.includes('coffee.edit')) add.push('coffee.edit')
    if (add.length > 0) {
      await db.role.update({
        where: { id: role.id },
        data: { permissions: JSON.stringify([...perms, ...add]) },
      })
      console.log(`+ ${role.name}: added ${add.join(', ')}`)
    } else {
      console.log(`- ${role.name}: already up to date`)
    }
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err)
    await db.$disconnect()
    process.exit(1)
  })

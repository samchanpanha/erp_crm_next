import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const pid = process.argv[2]
  const anyProposal = await db.proposal.findFirst()
  if (!anyProposal) throw new Error('no proposal found')
  await db.proposalLine.create({ data: { proposalId: anyProposal.id, productId: pid, label: 'Smoke Test Widget v2', qty: 1, unitPrice: 100, sort: 99 } })
  console.log('proposalLine created referencing', pid)
}
main().finally(() => db.$disconnect())

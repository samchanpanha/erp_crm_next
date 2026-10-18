import { TEMPLATE_TYPES, templateConfigSchema, type TemplateType } from './template-schema'
import type { Prisma, PrismaClient } from '@prisma/client'

const SEED_NAMES: Record<TemplateType, string> = {
  INVOICE: 'Classic invoice',
  RECEIPT: 'Classic receipt',
  PROPOSAL: 'Classic proposal',
  ORDER: 'Classic sale order',
  SUPPLIER_INVOICE: 'Classic supplier invoice',
}

type DbClient = Prisma.TransactionClient | PrismaClient

/**
 * Create one starter template per type for a tenant (no-op when the tenant
 * already has templates). Relative imports so bun scripts can use it too.
 */
export async function seedDocTemplatesForTenant(db: DbClient, tenantId: string) {
  const count = await db.docTemplate.count({ where: { tenantId } })
  if (count > 0) return
  await db.docTemplate.createMany({
    data: TEMPLATE_TYPES.map((type) => ({
      tenantId,
      name: SEED_NAMES[type],
      type,
      isDefault: true,
      config: JSON.stringify(templateConfigSchema.parse({})),
    })),
  })
}

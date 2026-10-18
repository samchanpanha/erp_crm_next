/**
 * Isomorphic import/export configuration shared by the import wizard (client)
 * and the Excel export/template generator (server) so the two can never drift.
 */

export type ImportEntity = 'third-parties' | 'products'

export interface EntityImportConfig {
  label: string
  sheetName: string
  keyColumn: string
  headers: string[]
  required: string[]
  templateRows: Record<string, string>[]
}

export const IMPORT_CONFIG: Record<ImportEntity, EntityImportConfig> = {
  'third-parties': {
    label: 'third parties',
    sheetName: 'Third parties',
    keyColumn: 'code',
    headers: [
      'code', 'name', 'type', 'status', 'email', 'phone', 'website', 'address',
      'zip', 'city', 'country', 'vatNumber', 'currency', 'paymentTerms', 'notes',
    ],
    required: ['name'],
    templateRows: [
      {
        code: '',
        name: 'Globex Corporation',
        type: 'CUSTOMER',
        status: 'ACTIVE',
        email: 'contact@globex.com',
        phone: '+1 555 234 1180',
        website: 'https://globex.com',
        address: '123 Market Street',
        zip: '94105',
        city: 'San Francisco',
        country: 'USA',
        vatNumber: 'US-987654321',
        currency: 'USD',
        paymentTerms: 'NET30',
        notes: 'Key enterprise account',
      },
      {
        code: '',
        name: 'Acme Supplies Ltd.',
        type: 'SUPPLIER',
        status: 'ACTIVE',
        email: 'sales@acmesupplies.co.uk',
        phone: '+44 20 7946 0958',
        website: 'https://acmesupplies.co.uk',
        address: '45 Harbour Lane',
        zip: 'EH6 6QQ',
        city: 'Edinburgh',
        country: 'UK',
        vatNumber: 'GB-123456789',
        currency: 'EUR',
        paymentTerms: 'NET15',
        notes: 'Leave code empty to auto-generate',
      },
    ],
  },
  products: {
    label: 'products & services',
    sheetName: 'Products',
    keyColumn: 'ref',
    headers: [
      'ref', 'label', 'type', 'description', 'unit', 'sellPrice', 'costPrice',
      'vatRate', 'barcode', 'manageStock', 'stockQty', 'minStock', 'status',
    ],
    required: ['label'],
    templateRows: [
      {
        ref: '',
        label: 'Ergonomic Office Chair',
        type: 'PRODUCT',
        description: 'Mesh back, adjustable lumbar support',
        unit: 'unit',
        sellPrice: '249.00',
        costPrice: '140.50',
        vatRate: '20',
        barcode: '9780201379624',
        manageStock: 'yes',
        stockQty: '25',
        minStock: '5',
        status: 'ACTIVE',
      },
      {
        ref: '',
        label: 'Onsite Installation Service',
        type: 'SERVICE',
        description: 'On-site setup by a certified technician (per hour)',
        unit: 'hour',
        sellPrice: '80',
        costPrice: '45',
        vatRate: '20',
        barcode: '',
        manageStock: 'no',
        stockQty: '0',
        minStock: '0',
        status: 'ACTIVE',
      },
    ],
  },
}

export function isImportEntity(value: string): value is ImportEntity {
  return value === 'third-parties' || value === 'products'
}

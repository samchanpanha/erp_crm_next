/**
 * Isomorphic permission catalog for DoliNext RBAC.
 * Safe to import from both client and server code (no node-only APIs).
 *
 * Permission strings are "<module>.<action>" where action is "view" or "edit".
 * The wildcard "*" grants everything (Administrator role).
 */

export type PermissionAction = 'view' | 'edit'

export interface PermissionModule {
  module: string
  label: string
  group: string
}

export const PERMISSION_MODULES: PermissionModule[] = [
  { module: 'thirdparties', label: 'Third parties & contacts', group: 'CRM' },
  { module: 'opportunities', label: 'Opportunities', group: 'CRM' },
  { module: 'proposals', label: 'Commercial proposals', group: 'Sales' },
  { module: 'saleorders', label: 'Sale orders', group: 'Sales' },
  { module: 'contracts', label: 'Contracts', group: 'Sales' },
  { module: 'invoices', label: 'Customer invoices', group: 'Billing' },
  { module: 'payments', label: 'Payments', group: 'Billing' },
  { module: 'purchaseorders', label: 'Supplier orders', group: 'Purchasing' },
  { module: 'supplierinvoices', label: 'Supplier invoices', group: 'Purchasing' },
  { module: 'products', label: 'Products & services', group: 'Catalog' },
  { module: 'stock', label: 'Stock & warehouses', group: 'Catalog' },
  { module: 'bank', label: 'Bank & cash', group: 'Finance' },
  { module: 'reports', label: 'Reports', group: 'Analysis' },
  { module: 'projects', label: 'Projects & tasks', group: 'Operations' },
  { module: 'employees', label: 'Employees', group: 'HR' },
  { module: 'leave', label: 'Leave requests', group: 'HR' },
  { module: 'expenses', label: 'Expense reports', group: 'HR' },
  { module: 'tickets', label: 'Tickets', group: 'Support' },
  { module: 'knowledge', label: 'Knowledge base', group: 'Support' },
  { module: 'agenda', label: 'Agenda', group: 'Productivity' },
  { module: 'data', label: 'Import / Export', group: 'Administration' },
  { module: 'settings', label: 'Settings & templates', group: 'Administration' },
  { module: 'administration', label: 'Users & roles', group: 'Administration' },
]

export function perm(module: string, action: PermissionAction): string {
  return `${module}.${action}`
}

export function hasPerm(permissions: string[], needed: string): boolean {
  return permissions.includes('*') || permissions.includes(needed)
}

export function canView(permissions: string[], moduleName: string): boolean {
  return hasPerm(permissions, perm(moduleName, 'view'))
}

export function canEdit(permissions: string[], moduleName: string): boolean {
  return hasPerm(permissions, perm(moduleName, 'edit'))
}

/**
 * Super administrator = the wildcard "*" permission (the account owner).
 * Reserved for owner-only actions such as setting the Buy-me-a-coffee KHQR
 * payment image — the QR must always belong to the account owner.
 */
export function isSuperAdmin(permissions: string[]): boolean {
  return permissions.includes('*')
}

export interface SystemRoleDef {
  name: string
  description: string
  permissions: string[]
}

const ALL_MODULES = PERMISSION_MODULES.map((m) => m.module)

function allPerms(action: PermissionAction): string[] {
  return ALL_MODULES.map((m) => perm(m, action))
}

/** Role presets seeded for every new tenant at registration (and the demo tenant). */
export const SYSTEM_ROLE_DEFS: SystemRoleDef[] = [
  {
    name: 'Administrator',
    description: 'Full access to everything, including users, roles and settings.',
    permissions: ['*'],
  },
  {
    name: 'Manager',
    description: 'Runs the business: all modules and settings, but cannot manage users & roles.',
    permissions: [
      ...allPerms('view'),
      ...allPerms('edit').filter((p) => !p.startsWith('administration.')),
    ],
  },
  {
    name: 'Sales',
    description: 'CRM & sales pipeline: third parties, opportunities, proposals, orders, contracts.',
    permissions: [
      'thirdparties.view', 'thirdparties.edit',
      'opportunities.view', 'opportunities.edit',
      'proposals.view', 'proposals.edit',
      'saleorders.view', 'saleorders.edit',
      'contracts.view', 'contracts.edit',
      'products.view',
      'invoices.view',
      'payments.view',
      'reports.view',
      'knowledge.view',
      'data.view',
    ],
  },
  {
    name: 'Accountant',
    description: 'Billing & finance: invoices, supplier invoices, payments, bank, expenses.',
    permissions: [
      'thirdparties.view',
      'products.view',
      'purchaseorders.view',
      'invoices.view', 'invoices.edit',
      'payments.view', 'payments.edit',
      'supplierinvoices.view', 'supplierinvoices.edit',
      'bank.view', 'bank.edit',
      'expenses.view', 'expenses.edit',
      'reports.view',
      'data.view',
    ],
  },
  {
    name: 'Viewer',
    description: 'Read-only access to every module.',
    permissions: [...allPerms('view')],
  },
]

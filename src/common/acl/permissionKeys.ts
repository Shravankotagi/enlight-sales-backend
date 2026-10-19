/** Keep in sync with frontend/src/utils/aclConstants.ts DEFAULT_ROLE_TEMPLATES. */

export const PERMISSION_KEYS = [
  'customers.view',
  'customers.create',
  'customers.edit',
  'customers.delete',
  'customers.reassign',
  'customers.scope_assigned',
  'customers.toggle_active',
  'visits.view',
  'visits.log',
  'visits.update',
  'visits.delete',
  'visits.approve',
  'visits.scope_assigned',
  'visits.photo_required',
  'inquiries.view',
  'inquiries.manage',
  'inquiries.edit',
  'inquiries.delete',
  'inquiries.send_quote',
  'inquiries.scope_assigned',
  'inquiries.fill_base_prices',
  'inquiries.price_override',
  'inquiries.team_inquiries',
  'orders.view',
  'orders.create',
  'orders.update',
  'deals.delete',
  'orders.attach_po',
  'orders.scope_assigned',
  'complaints.view',
  'complaints.log',
  'complaints.update',
  'complaints.delete',
  'complaints.resolve',
  'complaints.scope_assigned',
  'staff.view',
  'staff.create',
  'staff.manage',
  'staff.delete',
  'clients.import_csv',
  'staff.manage_acl',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

const KEY_SET = new Set<string>(PERMISSION_KEYS);

export const ROLE_DATA_SCOPE: Record<string, 'own' | 'team' | 'all'> = {
  admin: 'all',
  sales_manager: 'team',
  salesperson: 'own',
  procurement_manager: 'own',
  procurement_person: 'own',
};

function flags(on: string[]): Record<string, boolean> {
  const row: Record<string, boolean> = {};
  for (const key of PERMISSION_KEYS) row[key] = on.includes(key);
  return row;
}

const SCOPE_KEYS = [
  'customers.scope_assigned',
  'visits.scope_assigned',
  'inquiries.scope_assigned',
  'orders.scope_assigned',
  'complaints.scope_assigned',
];

const ALL_ON = PERMISSION_KEYS.filter((key) => !SCOPE_KEYS.includes(key));

export const BUILTIN_ROLE_TEMPLATES: Record<string, Record<string, boolean>> = {
  salesperson: flags([
    'customers.view',
    'customers.create',
    'customers.edit',
    'customers.scope_assigned',
    'visits.view',
    'visits.log',
    'visits.scope_assigned',
    'visits.photo_required',
    'inquiries.view',
    'inquiries.manage',
    'inquiries.edit',
    'inquiries.send_quote',
    'inquiries.scope_assigned',
    'orders.view',
    'orders.create',
    'orders.update',
    'orders.attach_po',
    'orders.scope_assigned',
    'complaints.view',
    'complaints.log',
    'complaints.update',
    'complaints.scope_assigned',
  ]),
  sales_manager: flags([
    'customers.view',
    'customers.create',
    'customers.edit',
    'customers.delete',
    'customers.reassign',
    'visits.view',
    'visits.log',
    'visits.update',
    'visits.delete',
    'visits.approve',
    'visits.photo_required',
    'inquiries.view',
    'inquiries.manage',
    'inquiries.edit',
    'inquiries.delete',
    'inquiries.send_quote',
    'inquiries.price_override',
    'inquiries.team_inquiries',
    'orders.view',
    'orders.create',
    'orders.update',
    'deals.delete',
    'orders.attach_po',
    'complaints.view',
    'complaints.log',
    'complaints.update',
    'complaints.delete',
    'complaints.resolve',
    'staff.view',
  ]),
  procurement_person: flags([
    'inquiries.view',
    'inquiries.manage',
    'inquiries.edit',
    'inquiries.scope_assigned',
    'inquiries.fill_base_prices',
  ]),
  procurement_manager: flags([
    'inquiries.view',
    'inquiries.manage',
    'inquiries.edit',
    'inquiries.delete',
    'inquiries.price_override',
    'inquiries.fill_base_prices',
    'inquiries.team_inquiries',
    'staff.view',
  ]),
  admin: flags(ALL_ON),
};

export function normalizeRoleId(role?: string | null): string {
  const raw = String(role || '').trim();
  if (raw === 'manager') return 'sales_manager';
  return raw || 'salesperson';
}

export function isKnownPermissionKey(key: string): boolean {
  return KEY_SET.has(key);
}

/** Role template first, then boolean overrides. Unknown keys are ignored. */
export function mergePermissions(
  rolePerms?: Record<string, boolean> | null,
  overrides?: Record<string, boolean> | null,
): Record<string, boolean> {
  const merged: Record<string, boolean> = {
    ...BUILTIN_ROLE_TEMPLATES.salesperson,
  };
  if (rolePerms && typeof rolePerms === 'object') {
    for (const [key, value] of Object.entries(rolePerms)) {
      if (KEY_SET.has(key) && typeof value === 'boolean') merged[key] = value;
    }
  }
  if (overrides && typeof overrides === 'object') {
    for (const [key, value] of Object.entries(overrides)) {
      if (KEY_SET.has(key) && typeof value === 'boolean') merged[key] = value;
    }
  }
  return merged;
}

export function legacyDataScope(role?: string | null): 'own' | 'team' | 'all' {
  const id = normalizeRoleId(role);
  return ROLE_DATA_SCOPE[id] || 'own';
}

export function assertKnownPermissions(perms: Record<string, boolean>) {
  const unknown = Object.keys(perms || {}).filter((key) => !KEY_SET.has(key));
  return unknown;
}

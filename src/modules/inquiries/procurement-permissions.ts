/**
 * Inquiry ACL for procurement. The role template is the default.
 * A stored employees.permissions object overlays it. A sub-permission
 * counts only when its parent is on.
 */

export const PROCUREMENT_INQUIRY_DEFAULTS: Record<
  string,
  Record<string, boolean>
> = {
  procurement_person: {
    'inquiries.view': true,
    'inquiries.manage': false,
    'inquiries.edit': true,
    'inquiries.delete': false,
    'inquiries.send_quote': false,
    'inquiries.scope_assigned': true,
    'inquiries.price_override': false,
    'inquiries.fill_base_prices': true,
    'inquiries.team_inquiries': false,
  },
  procurement_manager: {
    'inquiries.view': true,
    'inquiries.manage': false,
    'inquiries.edit': true,
    'inquiries.delete': true,
    'inquiries.send_quote': false,
    'inquiries.scope_assigned': false,
    'inquiries.price_override': true,
    'inquiries.fill_base_prices': true,
    'inquiries.team_inquiries': true,
  },
};

export function resolveProcurementPermissions(
  employee: {
    role?: string | null;
    permissions?: Record<string, boolean> | null;
  } | null,
): Record<string, boolean> {
  const role = String(employee?.role || '').toLowerCase();
  const defaults = {
    ...(PROCUREMENT_INQUIRY_DEFAULTS[role] || {}),
  };
  const stored = employee?.permissions;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return defaults;
  }
  const overlay: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value === 'boolean') overlay[key] = value;
  }
  return { ...defaults, ...overlay };
}

export function canViewInquiries(permissions: Record<string, boolean>) {
  return permissions['inquiries.view'] === true;
}

export function canEditInquiries(permissions: Record<string, boolean>) {
  return (
    canViewInquiries(permissions) && permissions['inquiries.edit'] === true
  );
}

export function canFillBasePrices(permissions: Record<string, boolean>) {
  return (
    canEditInquiries(permissions) &&
    permissions['inquiries.fill_base_prices'] === true
  );
}

export function canDeleteInquiries(permissions: Record<string, boolean>) {
  return (
    canViewInquiries(permissions) && permissions['inquiries.delete'] === true
  );
}

export function canSendQuote(permissions: Record<string, boolean>) {
  return (
    canViewInquiries(permissions) &&
    permissions['inquiries.send_quote'] === true
  );
}

export function procurementScopeMode(
  permissions: Record<string, boolean>,
): 'team' | 'assigned' | 'stamped' {
  if (permissions['inquiries.team_inquiries'] === true) return 'team';
  if (permissions['inquiries.scope_assigned'] === true) return 'assigned';
  return 'stamped';
}

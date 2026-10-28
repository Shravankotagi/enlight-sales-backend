export const INVOICE_KEYS = {
  view: 'invoices.view',
  create: 'invoices.create',
  edit: 'invoices.edit',
  approve: 'invoices.approve',
} as const;

export const ASSISTANT_KEY = 'assistant.use';

export const ACCOUNTS_PERMISSIONS: Record<string, boolean> = {
  [INVOICE_KEYS.view]: true,
  [INVOICE_KEYS.create]: true,
  [INVOICE_KEYS.edit]: true,
  [INVOICE_KEYS.approve]: true,
  [ASSISTANT_KEY]: true,
};

const EXTRA_ROUTES: Array<[string, string]> = [
  ['/customers', 'customers.view'],
  ['/visits', 'visits.view'],
  ['/inquiries', 'inquiries.view'],
  ['/pipeline', 'inquiries.view'],
  ['/orders', 'orders.view'],
  ['/complaints', 'complaints.view'],
  ['/reports', 'reports.view'],
  ['/logs', 'logs.view'],
  ['/intelligence', 'intelligence.view'],
  ['/home', 'home.view'],
];

export type AccessActor = {
  role?: string | null;
  permissions?: Record<string, boolean> | null;
} | null;

export function roleKey(role?: string | null): string {
  return String(role || '')
    .trim()
    .toLowerCase();
}

export function can(actor: AccessActor, key: string): boolean {
  if (!actor) return false;
  if (actor.permissions && typeof actor.permissions === 'object') {
    return actor.permissions[key] === true;
  }
  if (roleKey(actor.role) === 'accounts') {
    return ACCOUNTS_PERMISSIONS[key] === true;
  }
  if (key === ASSISTANT_KEY) return true;
  return false;
}

export function canUseInvoice(actor: AccessActor, key: string): boolean {
  if (!actor) return false;
  if (actor.permissions && typeof actor.permissions === 'object') {
    return actor.permissions[key] === true;
  }
  if (roleKey(actor.role) === 'admin') return true;
  return can(actor, key);
}

/** Sidebar paths an Accounts user may see. Null means the existing full menu. */
export function restrictedNav(actor: AccessActor): string[] | null {
  if (roleKey(actor?.role) !== 'accounts') return null;
  const paths: string[] = [];
  if (can(actor, ASSISTANT_KEY)) paths.push('/assistant');
  if (can(actor, INVOICE_KEYS.view)) paths.push('/invoices');
  if (actor?.permissions) {
    for (const [path, key] of EXTRA_ROUTES) {
      if (actor.permissions[key] === true) paths.push(path);
    }
  }
  return paths;
}

export function accountsRequestAllowed(
  actor: AccessActor,
  method: string,
  rawPath: string,
): boolean {
  if (roleKey(actor?.role) !== 'accounts') return true;
  const path = String(rawPath || '').split('?')[0];
  if (path.startsWith('/auth') || path.startsWith('/health')) return true;
  if (path.startsWith('/chat')) return can(actor, ASSISTANT_KEY);
  if (path === '/invoices' || path.startsWith('/invoices/')) {
    const verb = method.toUpperCase();
    if (verb === 'GET') return can(actor, INVOICE_KEYS.view);
    if (verb === 'POST' && path.endsWith('/approve')) {
      return can(actor, INVOICE_KEYS.approve);
    }
    if (verb === 'POST') return can(actor, INVOICE_KEYS.create);
    if (verb === 'PATCH' || verb === 'PUT')
      return can(actor, INVOICE_KEYS.edit);
    return can(actor, INVOICE_KEYS.view);
  }
  if (actor?.permissions) {
    const extra = EXTRA_ROUTES.find(
      ([prefix]) => path === prefix || path.startsWith(`${prefix}/`),
    );
    if (extra && actor.permissions[extra[1]] === true) return true;
  }
  return false;
}

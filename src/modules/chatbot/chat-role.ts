/** Procurement is checked before any "manager" match. procurement_manager contains that word. */
export function mapChatRole(rawRole?: string | null): string {
  const role = String(rawRole || '').toLowerCase();
  if (role === 'procurement_person' || role === 'procurement_manager') {
    return role;
  }
  if (role.includes('admin')) return 'admin';
  if (
    role === 'sales_manager' ||
    role === 'manager' ||
    role.includes('manager')
  ) {
    return 'manager';
  }
  return 'salesperson';
}

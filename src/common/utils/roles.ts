export function isProcurementManager(role?: string | null): boolean {
  return String(role || '').toLowerCase() === 'procurement_manager';
}

export function isProcurementPerson(role?: string | null): boolean {
  return String(role || '').toLowerCase() === 'procurement_person';
}

/** Check this before any role.includes('manager'): procurement_manager contains "manager". */
export function isProcurementRole(role?: string | null): boolean {
  return isProcurementManager(role) || isProcurementPerson(role);
}

export function getAssignedPhoneFromCustomerMap(
  customerName?: string | null,
  customerOwnerMap?: Map<string, string>,
): string | null {
  if (!customerName || !customerOwnerMap || customerOwnerMap.size === 0)
    return null;
  const clean = customerName.toLowerCase().trim();
  if (customerOwnerMap.has(clean)) return customerOwnerMap.get(clean)!;

  const stripped = clean
    .replace(
      /\b(private\s+limited|pvt\s+ltd|pvt\s+limited|private\s+ltd|co\s+ltd|co\s+limited|llp|limited|pvt|ltd|inc|corp|co|corporation)\b/gi,
      '',
    )
    .replace(/[^a-z0-9]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!stripped) return null;

  for (const [name, phone] of customerOwnerMap.entries()) {
    if (name === clean) return phone;
    const mapStripped = name
      .replace(
        /\b(private\s+limited|pvt\s+ltd|pvt\s+limited|private\s+ltd|co\s+ltd|co\s+limited|llp|limited|pvt|ltd|inc|corp|co|corporation)\b/gi,
        '',
      )
      .replace(/[^a-z0-9]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      mapStripped &&
      (stripped === mapStripped ||
        stripped.startsWith(mapStripped) ||
        mapStripped.startsWith(stripped))
    ) {
      return phone;
    }
  }
  return null;
}

export function buildCustomerOwnerMap(
  customers?: any[],
  validEmployeePhones?: Set<string> | Map<string, any>,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(customers) || customers.length === 0) return map;

  // Sort descending by updated_at so newer rows take precedence over older rows
  const sorted = [...customers].sort((a, b) => {
    const tA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const tB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return tB - tA;
  });

  for (const c of sorted) {
    if (!c.customer_name || !c.assigned_salesperson_phone) continue;
    const cleanKey = c.customer_name.trim().toLowerCase();
    if (map.has(cleanKey)) continue;

    const cleanPhone = String(c.assigned_salesperson_phone)
      .replace(/\D/g, '')
      .slice(-10);
    // Admin Dhananjay Goel (9975003940) or unassigned should never override field reps
    if (!cleanPhone || cleanPhone === '9975003940') continue;

    if (validEmployeePhones && validEmployeePhones.size > 0) {
      const isValid =
        validEmployeePhones instanceof Map
          ? validEmployeePhones.has(cleanPhone)
          : validEmployeePhones.has(cleanPhone);
      if (!isValid) continue;
    }

    map.set(cleanKey, c.assigned_salesperson_phone);
  }
  return map;
}

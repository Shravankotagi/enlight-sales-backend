export function isValidSalespersonPhone(phone?: string | null): boolean {
  if (!phone || typeof phone !== 'string') return false;
  const lower = phone.trim().toLowerCase();
  if (lower === 'unassigned' || lower === 'null' || lower === 'undefined')
    return false;
  const clean = phone.replace(/\D/g, '').slice(-10);
  if (!clean || clean.length < 10) return false;
  if (clean === '9975003940' || clean === '0000000000') return false;
  return true;
}

export function getAssignedPhoneFromCustomerMap(
  customerName?: string | null,
  customerOwnerMap?: Map<string, string>,
): string | null {
  if (!customerName || !customerOwnerMap || customerOwnerMap.size === 0)
    return null;
  const clean = customerName.toLowerCase().trim();
  let candidate: string | null = null;
  if (customerOwnerMap.has(clean)) {
    candidate = customerOwnerMap.get(clean)!;
  } else {
    const stripped = clean
      .replace(
        /\b(private\s+limited|pvt\s+ltd|pvt\s+limited|private\s+ltd|co\s+ltd|co\s+limited|llp|limited|pvt|ltd|inc|corp|co|corporation)\b/gi,
        '',
      )
      .replace(/[^a-z0-9]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (stripped) {
      for (const [name, phone] of customerOwnerMap.entries()) {
        if (name === clean) {
          candidate = phone;
          break;
        }
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
          candidate = phone;
          break;
        }
      }
    }
  }

  if (candidate && isValidSalespersonPhone(candidate)) {
    return candidate;
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
    if (!isValidSalespersonPhone(c.assigned_salesperson_phone)) continue;

    const cleanKey = c.customer_name.trim().toLowerCase();
    if (map.has(cleanKey)) continue;

    const cleanPhone = String(c.assigned_salesperson_phone)
      .replace(/\D/g, '')
      .slice(-10);

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

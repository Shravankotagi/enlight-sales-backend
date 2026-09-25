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

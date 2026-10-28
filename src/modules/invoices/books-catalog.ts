export type BooksAccount = { account_id: string; account_name: string };
export type BooksTax = {
  tax_id: string;
  tax_name: string;
  tax_percentage: number;
};
export type BooksField = { customfield_id: string; label: string };

export type BooksCatalog = {
  accountId: string | null;
  gstTaxId: string | null;
  tdsTaxId: string | null;
  fields: Record<string, string>;
  missing: string[];
};

const FIELD_LABELS = [
  'DC To',
  'Sale To',
  'Vehicle Number',
  'LR Number',
] as const;

export function matchBooksCatalog(input: {
  accounts?: BooksAccount[];
  taxes?: BooksTax[];
  fields?: BooksField[];
}): BooksCatalog {
  const account = (input.accounts || []).find((row) =>
    /inventory\s*asset/i.test(row.account_name || ''),
  );
  const gst = (input.taxes || []).find(
    (row) =>
      Number(row.tax_percentage) === 18 && /gst/i.test(row.tax_name || ''),
  );
  const tds = (input.taxes || []).find(
    (row) =>
      Math.abs(Number(row.tax_percentage) - 0.1) < 0.001 ||
      /tds/i.test(row.tax_name || ''),
  );
  const fields: Record<string, string> = {};
  for (const label of FIELD_LABELS) {
    const found = (input.fields || []).find(
      (row) =>
        String(row.label || '')
          .trim()
          .toLowerCase() === label.toLowerCase(),
    );
    if (found?.customfield_id) fields[label] = found.customfield_id;
  }
  const missing: string[] = [];
  if (!account) missing.push('Inventory Asset');
  if (!gst) missing.push('GST 18%');
  if (!tds) missing.push('TDS 0.1%');
  for (const label of FIELD_LABELS) {
    if (!fields[label]) missing.push(label);
  }
  return {
    accountId: account?.account_id || null,
    gstTaxId: gst?.tax_id || null,
    tdsTaxId: tds?.tax_id || null,
    fields,
    missing,
  };
}

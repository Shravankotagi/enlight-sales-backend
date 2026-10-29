export type DispatchTemplate = {
  purchaseFrom: string;
  saleTo: string;
  poNumber: string;
  deliveryOrder: string;
  salesOfficer: string;
  grade: string;
  size: string;
  weightKg: number | null;
  vehicleNumber: string;
  driverPhone: string;
  transporter: string;
  dispatchLocation: string;
};

export type SlipReading = {
  netKg?: number | null;
  vehicleNumber?: string | null;
  billNumber?: string | null;
  billDate?: string | null;
  ewayBill?: string | null;
  vendorRate?: number | null;
  lrNumber?: string | null;
  transporter?: string | null;
  pieces?: number | null;
};

const FIELD = (label: string) => new RegExp(`${label}\\s*:\\s*([^\\n|]+)`, 'i');

function field(text: string, label: string): string {
  const match = text.match(FIELD(label));
  return (match?.[1] || '').trim();
}

function pair(text: string, left: string, right: string): [string, string] {
  const line = text
    .split('\n')
    .find(
      (row) =>
        new RegExp(left, 'i').test(row) && new RegExp(right, 'i').test(row),
    );
  if (!line) return [field(text, left), field(text, right)];
  const [a, b] = line.split('|');
  return [
    field(a || '', left) || field(text, left),
    field(b || '', right) || field(text, right),
  ];
}

export function parseDispatchTemplate(text: string): DispatchTemplate {
  const source = String(text || '');
  const [deliveryOrder, salesOfficer] = pair(source, 'DO', 'SO');
  const [grade, size] = pair(source, 'Grade', 'Size');
  const [vehicleNumber, driverPhone] = pair(source, 'Vehicle No', 'Driver');
  const weightRaw = field(source, 'Weight \\(kg\\)') || field(source, 'Weight');
  const weight = Number(String(weightRaw).replace(/,/g, ''));
  return {
    purchaseFrom: field(source, 'Purchase From'),
    saleTo: field(source, 'Sale To'),
    poNumber: field(source, 'Delivery As Per')
      .replace(/^PO[-\s]*/i, 'PO-')
      .replace(/^PO-PO-/i, 'PO-'),
    deliveryOrder,
    salesOfficer,
    grade,
    size,
    weightKg: Number.isFinite(weight) && weight > 0 ? weight : null,
    vehicleNumber,
    driverPhone,
    transporter: field(source, 'Transport'),
    dispatchLocation: field(source, 'Dispatch'),
  };
}

export function normalizeToken(value?: string | null): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function poKey(value?: string | null): string {
  return normalizeToken(value).replace(/^PO/, '');
}

export function idempotencyKey(
  billNumber?: string | null,
  vehicle?: string | null,
  po?: string | null,
): string {
  return [normalizeToken(billNumber), normalizeToken(vehicle), poKey(po)].join(
    '|',
  );
}

export function weightsMatch(
  templateKg: number | null,
  slipKg: number | null,
): boolean {
  if (templateKg == null || slipKg == null) return false;
  return Math.abs(templateKg - slipKg) <= 0.5;
}

export function vehiclesMatch(
  templateVehicle?: string | null,
  slipVehicle?: string | null,
): boolean {
  const left = normalizeToken(templateVehicle);
  const right = normalizeToken(slipVehicle);
  return Boolean(left) && left === right;
}

export function kgToMt(kg: number): number {
  return kg / 1000;
}

export function buildDraftInvoicePatch(input: {
  quantityMt: number;
  sellingRatePerMt: number;
  description: string;
}) {
  return {
    status: 'draft',
    line_items: [
      {
        quantity: input.quantityMt,
        rate: input.sellingRatePerMt,
        description: input.description,
      },
    ],
  };
}

export function missingTemplateFields(template: DispatchTemplate): string[] {
  const missing: string[] = [];
  if (!template.purchaseFrom) missing.push('Purchase From is missing.');
  if (!template.saleTo) missing.push('Sale To is missing.');
  if (!template.poNumber) missing.push('Customer PO is missing.');
  if (!template.grade) missing.push('Grade is missing.');
  if (!template.size) missing.push('Size is missing.');
  if (template.weightKg == null) missing.push('Weight is missing.');
  if (!template.vehicleNumber) missing.push('Vehicle number is missing.');
  if (!template.salesOfficer) missing.push('Sales officer is missing.');
  if (!template.transporter) missing.push('Transporter is missing.');
  return missing;
}

import { BadRequestException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import axios from 'axios';

export const VISIT_BRANDS = [
  'TATA',
  'JSW',
  'AM/NS India',
  'SAIL',
  'NMDC',
  'Apollo',
  'Others',
] as const;

export const VISIT_PAYMENT_TERMS = [
  'Immediate',
  'Advance',
  '30 Days',
  '45 Days',
  '60 Days',
  'LC',
  'BG',
  'PDC',
] as const;

export const VISIT_CUSTOMER_TYPES = [
  'OEM',
  'Fabricator',
  'EPC',
  'Manufacturer',
  'Trader',
] as const;

export const VISIT_TYPES = [
  'First Visit',
  'Follow-up 1',
  'Follow-up 2',
  'Follow-up 3',
  'Regular Visit',
] as const;

export const VISIT_OUTCOMES = ['positive', 'neutral', 'negative'] as const;
export const VISIT_PROBABILITIES = ['Hot', 'Warm', 'Cold'] as const;

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_RESEND_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const TOKEN_TTL_MS = 10 * 60 * 1000;
export const MAX_VISIT_DOCUMENT_BYTES = 5 * 1024 * 1024;

const DOCUMENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
]);

export function hashVisitSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function generateVisitOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function generateVisitToken(): string {
  return randomBytes(32).toString('hex');
}

export function normalizeVisitPhone(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  const phone = digits.length > 10 ? digits.slice(-10) : digits;
  if (phone.length !== 10) {
    throw new BadRequestException('Enter a valid 10-digit mobile number.');
  }
  return phone;
}

export function cityFromNominatim(body: any): string | null {
  const address = body?.address || {};
  const city =
    address.city ||
    address.town ||
    address.city_district ||
    address.municipality ||
    address.suburb ||
    address.village ||
    address.county ||
    '';
  const text = String(city).trim();
  return text || null;
}

export function addressFromNominatim(body: any): string | null {
  const address = body?.address || {};
  const building = [
    body?.namedetails?.name,
    body?.name,
    address.building,
    address.house_name,
    address.amenity,
    address.shop,
    address.office,
    address.tourism,
  ]
    .map((part) => String(part ?? '').trim())
    .find(Boolean) || '';
  const street = [
    address.road,
    address.pedestrian,
    address.footway,
    address.street,
    address.residential,
  ]
    .map((part) => String(part ?? '').trim())
    .find(Boolean) || '';
  const locality = [
    address.city,
    address.town,
    address.city_district,
    address.municipality,
    address.village,
    address.county,
  ]
    .map((part) => String(part ?? '').trim())
    .find(Boolean) || '';
  const parts = [
    building,
    address.house_number,
    street,
    address.suburb || address.neighbourhood,
    locality,
    address.state,
    address.postcode,
  ]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  const composed = unique.join(', ');
  if (building || street) return composed || null;
  const display = String(body?.display_name ?? '').trim();
  return display || composed || null;
}

function googleComponent(result: any, type: string): string {
  const match = (result?.address_components || []).find((part: any) =>
    Array.isArray(part?.types) && part.types.includes(type),
  );
  return String(match?.long_name ?? '').trim();
}

function googleResultRank(result: any): number {
  const types = Array.isArray(result?.types) ? result.types : [];
  const has = (type: string) => types.includes(type);
  let rank = 0;
  if (has('premise') || has('subpremise') || has('street_address')) rank = 3;
  else if (has('establishment') || has('point_of_interest')) rank = 2;
  else if (has('route')) rank = 1;
  else if (googleComponent(result, 'premise') || googleComponent(result, 'subpremise')) rank = 3;
  else if (googleComponent(result, 'route')) rank = 1;
  if (result?.geometry?.location_type === 'ROOFTOP') rank += 0.5;
  return rank;
}

export function selectGoogleGeocodeResult(body: any): any | null {
  const results = Array.isArray(body?.results) ? body.results : [];
  let best: any = null;
  let bestRank = -1;
  for (const result of results) {
    const rank = googleResultRank(result);
    if (rank > bestRank) {
      best = result;
      bestRank = rank;
    }
  }
  return best;
}

export function addressFromGoogleGeocode(body: any): string | null {
  const result = selectGoogleGeocodeResult(body);
  if (!result) return null;
  const types = Array.isArray(result.types) ? result.types : [];
  const formatted = String(result.formatted_address ?? '').trim();
  const premise = googleComponent(result, 'premise') || googleComponent(result, 'subpremise');
  const streetNumber = googleComponent(result, 'street_number');
  const route = googleComponent(result, 'route');
  const firstSegment = formatted.split(',')[0]?.trim() || '';
  const isPlace = types.includes('establishment') || types.includes('point_of_interest');
  const building =
    premise ||
    (isPlace && firstSegment && firstSegment !== route && firstSegment !== streetNumber
      ? firstSegment
      : '');
  const street = [streetNumber, route].filter(Boolean).join(' ');
  if (!building && !street) return formatted || null;
  const area =
    googleComponent(result, 'sublocality_level_1') ||
    googleComponent(result, 'sublocality') ||
    googleComponent(result, 'neighborhood');
  const parts = [
    building,
    street,
    area,
    googleComponent(result, 'locality'),
    googleComponent(result, 'administrative_area_level_1'),
    googleComponent(result, 'postal_code'),
  ]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);
  const unique = parts.filter(
    (part, index) => parts.findIndex((item) => item.toLowerCase() === part.toLowerCase()) === index,
  );
  return unique.join(', ') || formatted || null;
}

export function cityFromGoogleGeocode(body: any): string | null {
  const result = selectGoogleGeocodeResult(body);
  if (!result) return null;
  return googleComponent(result, 'locality') || null;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function documentType(item: any): string {
  const declared = text(item?.type || item?.file_type).toLowerCase();
  if (declared) return declared;
  const name = text(item?.name || item?.file_name).toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  return '';
}

export interface NormalizedVisit {
  phone: string;
  preferredMake: string;
  preferredMakeOther: string | null;
  locationSource: 'gps' | 'manual';
  visitLatitude: number | null;
  visitLongitude: number | null;
}

export function assertNewVisit(data: any): NormalizedVisit {
  const required: Array<[unknown, string]> = [
    [data?.customer_name, 'Enter the customer name.'],
    [data?.person_met, 'Enter the person met.'],
    [data?.designation, 'Enter the designation.'],
    [data?.product_details, 'Enter the product details.'],
    [data?.monthly_consumption, 'Enter the monthly consumption.'],
    [data?.delivery_location, 'Enter the delivery location.'],
    [data?.current_requirement, 'Enter the current requirement.'],
    [data?.next_purchase_expected, 'Enter the next purchase date.'],
    [data?.follow_up_action, 'Enter the follow-up action.'],
    [data?.follow_up_date, 'Enter the follow-up date.'],
    [data?.remarks, 'Enter the meeting remarks.'],
    [data?.visited_at, 'Enter the visit date and time.'],
  ];
  for (const [value, message] of required) {
    if (!text(value)) throw new BadRequestException(message);
  }

  const email = text(data?.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('Enter a valid email.');
  }

  const phone = normalizeVisitPhone(data?.contact_phone || data?.contact_no);

  if (!VISIT_CUSTOMER_TYPES.includes(text(data?.customer_type) as any)) {
    throw new BadRequestException('Select a customer type.');
  }
  if (!VISIT_TYPES.includes(text(data?.visit_type) as any)) {
    throw new BadRequestException('Select a visit type.');
  }
  if (!VISIT_OUTCOMES.includes(text(data?.outcome).toLowerCase() as any)) {
    throw new BadRequestException('Select an outcome.');
  }
  if (!VISIT_PROBABILITIES.includes(text(data?.customer_probability) as any)) {
    throw new BadRequestException('Select the customer probability.');
  }
  if (!VISIT_PAYMENT_TERMS.includes(text(data?.payment_terms) as any)) {
    throw new BadRequestException('Select a payment term.');
  }

  const brands = (
    Array.isArray(data?.preferred_make)
      ? data.preferred_make
      : text(data?.preferred_make).split(',')
  )
    .map((brand: unknown) => text(brand))
    .filter(Boolean);
  if (brands.length === 0) {
    throw new BadRequestException('Select a preferred brand.');
  }
  if (brands.some((brand) => !VISIT_BRANDS.includes(brand as any))) {
    throw new BadRequestException('Select a preferred brand from the list.');
  }
  const other = text(data?.preferred_make_other);
  if (brands.includes('Others') && !other) {
    throw new BadRequestException('Enter the other brand.');
  }

  const location = text(data?.location || data?.city);
  if (!location) throw new BadRequestException('Enter the city.');
  const locationSource = text(data?.location_source);
  const visitLatitude = finiteNumber(data?.visit_latitude);
  const visitLongitude = finiteNumber(data?.visit_longitude);
  if (locationSource === 'manual') {
    // A typed city is allowed only when the device could not provide GPS.
  } else if (
    locationSource === 'gps' &&
    visitLatitude !== null &&
    visitLongitude !== null
  ) {
    // Locked device reading.
  } else {
    throw new BadRequestException(
      'Retry location so the city can be read from the device, or enter it manually when GPS is unavailable.',
    );
  }

  if (!text(data?.gps_photo_url)) {
    throw new BadRequestException('Take a visit photo with the camera.');
  }
  if (
    finiteNumber(data?.gps_latitude) === null ||
    finiteNumber(data?.gps_longitude) === null
  ) {
    throw new BadRequestException(
      'The visit photo must include GPS coordinates.',
    );
  }

  const attachments = Array.isArray(data?.attachments) ? data.attachments : [];
  for (const item of attachments) {
    const size = Number(item?.size || item?.file_size || 0);
    if (size > MAX_VISIT_DOCUMENT_BYTES) {
      throw new BadRequestException(
        'Supporting documents must be PDF, JPG, or PNG and no larger than 5 MB.',
      );
    }
    const type = documentType(item);
    if (type && !DOCUMENT_TYPES.has(type)) {
      throw new BadRequestException(
        'Supporting documents must be PDF, JPG, or PNG and no larger than 5 MB.',
      );
    }
  }

  if (!text(data?.verification_token)) {
    throw new BadRequestException(
      'Verify the customer phone before saving the visit.',
    );
  }

  return {
    phone,
    preferredMake: brands.join(', '),
    preferredMakeOther: brands.includes('Others') ? other : null,
    locationSource: locationSource === 'manual' ? 'manual' : 'gps',
    visitLatitude: locationSource === 'gps' ? visitLatitude : null,
    visitLongitude: locationSource === 'gps' ? visitLongitude : null,
  };
}

export function visitOtpTemplatePayload(
  phone: string,
  otp: string,
  templateName: string,
) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: otp }],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: otp }],
        },
      ],
    },
  };
}

export async function sendVisitOtpWhatsApp(
  phone: string,
  otp: string,
): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = String(process.env.WHATSAPP_VISIT_OTP_TEMPLATE || '').trim();
  if (!token || !phoneNumberId || !templateName) {
    throw new BadRequestException(
      'WhatsApp is not configured for visit codes.',
    );
  }

  await axios.post(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
    visitOtpTemplatePayload(phone, otp, templateName),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    },
  );
}

const VISIT_WHATSAPP_WINDOW_MESSAGE =
  'This number has not messaged Enlight Metals on WhatsApp in the last 24 hours. Ask them to send any message to the business number, then request the code again.';
const VISIT_WHATSAPP_UNREACHABLE_MESSAGE =
  'This number could not be reached on WhatsApp.';

function sanitizeMetaLogText(value: unknown): string {
  const text = String(value ?? '')
    .replace(/\d{6,}/g, '****')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return text || 'unavailable';
}

function visitWhatsAppUserMessage(
  code: string,
  rawMessage: unknown,
  metaMessage: string,
): string {
  const taggedCode = String(rawMessage ?? '').match(
    /\(#(131047|131026)\)/,
  )?.[1];
  const effectiveCode =
    code === '131047' || code === '131026' ? code : taggedCode;
  if (effectiveCode === '131047') return VISIT_WHATSAPP_WINDOW_MESSAGE;
  if (effectiveCode === '131026') return VISIT_WHATSAPP_UNREACHABLE_MESSAGE;
  return `The visit code could not be sent on WhatsApp (code ${code}): ${metaMessage}.`;
}

export function describeVisitWhatsAppFailure(err: unknown): {
  code: string;
  subcode: string;
  metaMessage: string;
  userMessage: string;
} {
  const meta = (
    err as { response?: { data?: { error?: Record<string, unknown> } } }
  )?.response?.data?.error;
  const codeNumber = Number(meta?.code);
  const subcodeNumber =
    meta?.error_subcode == null || meta.error_subcode === ''
      ? Number.NaN
      : Number(meta.error_subcode);
  const code = Number.isFinite(codeNumber) ? String(codeNumber) : 'unknown';
  const subcode = Number.isFinite(subcodeNumber)
    ? String(subcodeNumber)
    : 'none';
  const metaMessage = sanitizeMetaLogText(meta?.message);
  return {
    code,
    subcode,
    metaMessage,
    userMessage: visitWhatsAppUserMessage(code, meta?.message, metaMessage),
  };
}

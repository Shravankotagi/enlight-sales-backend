// Issue: <add GitHub issue link>
// A new visit cannot use a past next purchase date or follow-up date.
import { assertNewVisit } from '../modules/kra/visit-verification';

function isoDaysFromToday(days: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function validVisit(overrides: Record<string, unknown> = {}) {
  const today = isoDaysFromToday(0);
  return {
    customer_name: 'Acme',
    person_met: 'Ravi',
    designation: 'Buyer',
    contact_phone: '9822012345',
    email: 'ravi@acme.com',
    location: 'Pune',
    location_source: 'gps',
    visit_latitude: 18.52,
    visit_longitude: 73.85,
    customer_type: 'OEM',
    visit_type: 'First Visit',
    outcome: 'positive',
    customer_probability: 'Hot',
    product_details: 'HR Coil',
    monthly_consumption: '50 MT',
    preferred_make: ['TATA'],
    payment_terms: '30 Days',
    delivery_location: 'Chakan',
    next_purchase_expected: today,
    current_requirement: '10 MT',
    follow_up_action: 'Send quote',
    follow_up_date: today,
    remarks: 'Discussed rates',
    visited_at: '2026-10-15T10:00:00.000Z',
    gps_photo_url: 'data:image/jpeg;base64,abc',
    gps_latitude: 18.52,
    gps_longitude: 73.86,
    verification_token: 'token',
    ...overrides,
  };
}

describe('new visit future dates', () => {
  it('rejects a past next purchase date and a past follow-up date', () => {
    const yesterday = isoDaysFromToday(-1);
    expect(() =>
      assertNewVisit(validVisit({ next_purchase_expected: yesterday })),
    ).toThrow('Choose a next purchase date that is today or later.');
    expect(() =>
      assertNewVisit(validVisit({ follow_up_date: yesterday })),
    ).toThrow('Choose a follow-up date that is today or later.');
    expect(() =>
      assertNewVisit(validVisit({ follow_up_date: 'not-a-date' })),
    ).toThrow('Choose a follow-up date that is today or later.');
  });

  it('accepts today for both dates', () => {
    expect(assertNewVisit(validVisit()).phone).toBe('9822012345');
  });
});

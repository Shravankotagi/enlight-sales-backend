// Issue 238: new customer visits require a verified phone, a GPS photo, and standardized fields.
import { BadRequestException } from '@nestjs/common';
import { KraService } from '../modules/kra/kra.service';
import * as visitOtp from '../modules/kra/visit-verification';
import {
  addressFromNominatim,
  cityFromNominatim,
  describeVisitWhatsAppFailure,
} from '../modules/kra/visit-verification';

function createHarness() {
  const tables: Record<string, any[]> = {
    visit_phone_verifications: [],
    customer_visits: [],
  };
  let nextId = 1;
  const supabase = {
    from(table: string) {
      const rows = tables[table] || (tables[table] = []);
      return {
        select() {
          return {
            eq(_column: string, value: string) {
              return Promise.resolve({
                data: rows.filter((row) => row.phone === value),
                error: null,
              });
            },
            ilike() {
              throw new Error('lookup skipped');
            },
          };
        },
        insert(row: any) {
          const stored = {
            id: `${table}-${nextId++}`,
            created_at: new Date().toISOString(),
            ...row,
          };
          rows.push(stored);
          const result = { data: stored, error: null };
          return Object.assign(Promise.resolve(result), {
            select: () => ({ single: async () => result }),
          });
        },
        update(patch: any) {
          return {
            eq(_column: string, value: string) {
              const row = rows.find((item) => item.id === value);
              if (row) Object.assign(row, patch);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  const service = new KraService(
    { getAdminClient: () => supabase } as any,
    { logActivity: () => undefined } as any,
  );
  return { service, tables };
}

function validVisit(token: string, overrides: Record<string, unknown> = {}) {
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
    preferred_make: ['TATA', 'Others'],
    preferred_make_other: 'Local mill',
    payment_terms: '30 Days',
    delivery_location: 'Chakan',
    next_purchase_expected: '2026-11-01',
    current_requirement: '10 MT',
    follow_up_action: 'Send quote',
    follow_up_date: '2026-10-20',
    remarks: 'Discussed rates',
    visited_at: '2026-10-15T10:00:00.000Z',
    gps_photo_url: 'data:image/jpeg;base64,abc',
    gps_latitude: 18.52,
    gps_longitude: 73.86,
    verification_token: token,
    ...overrides,
  };
}

describe('issue 238 customer visit form', () => {
  beforeEach(() => {
    jest.spyOn(visitOtp, 'generateVisitOtp').mockReturnValue('123456');
    jest.spyOn(visitOtp, 'sendVisitOtpWhatsApp').mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads a city from a reverse-geocode response', () => {
    expect(
      cityFromNominatim({ address: { town: 'Chakan', state: 'Maharashtra' } }),
    ).toBe('Chakan');
    expect(
      cityFromNominatim({
        address: { suburb: 'Kandivali East', city_district: 'Mumbai Suburban' },
      }),
    ).toBe('Mumbai Suburban');
  });

  it('reads a full address from a reverse-geocode response', () => {
    expect(
      addressFromNominatim({
        display_name: '12, MG Road, Camp, Pune, Maharashtra, 411001, India',
        address: { city: 'Pune' },
      }),
    ).toBe('12, MG Road, Camp, Pune, Maharashtra, 411001, India');
    expect(
      addressFromNominatim({
        address: {
          house_number: '12',
          road: 'MG Road',
          suburb: 'Camp',
          city: 'Pune',
          state: 'Maharashtra',
          postcode: '411001',
        },
      }),
    ).toBe('12, MG Road, Camp, Pune, Maharashtra, 411001');
    expect(addressFromNominatim({ address: {} })).toBeNull();
  });

  it('sends one code and blocks a second request during the cooldown', async () => {
    const { service } = createHarness();
    await expect(service.requestVisitOtp('9822012345')).resolves.toMatchObject({
      resend_after_seconds: 60,
    });
    await expect(service.requestVisitOtp('98220 12345')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.requestVisitOtp('9822012345')).rejects.toThrow(
      'Wait 60 seconds before requesting another code.',
    );
  });

  it('rejects an expired code', async () => {
    const { service, tables } = createHarness();
    await service.requestVisitOtp('9822012345');
    tables.visit_phone_verifications[0].expires_at = new Date(
      Date.now() - 1000,
    ).toISOString();
    await expect(
      service.verifyVisitOtp('9822012345', '123456'),
    ).rejects.toThrow('This code has expired. Request a new one.');
  });

  it('locks the code after five wrong attempts', async () => {
    const { service } = createHarness();
    await service.requestVisitOtp('9822012345');
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(
        service.verifyVisitOtp('9822012345', '000000'),
      ).rejects.toThrow('That code is incorrect.');
    }
    await expect(
      service.verifyVisitOtp('9822012345', '000000'),
    ).rejects.toThrow('This code is locked. Request a new one.');
    await expect(
      service.verifyVisitOtp('9822012345', '123456'),
    ).rejects.toThrow('This code is locked. Request a new one.');
  });

  it('rejects a visit that has no verification token', async () => {
    const { service, tables } = createHarness();
    await expect(
      service.createVisit(validVisit(''), '919822011111'),
    ).rejects.toThrow('Verify the customer phone before saving the visit.');
    expect(tables.customer_visits).toHaveLength(0);
  });

  it('rejects a photo without GPS coordinates', async () => {
    const { service, tables } = createHarness();
    await expect(
      service.createVisit(
        validVisit('token', { gps_latitude: null, gps_longitude: null }),
        '919822011111',
      ),
    ).rejects.toThrow('The visit photo must include GPS coordinates.');
    expect(tables.customer_visits).toHaveLength(0);
  });

  it('rejects a brand or payment term outside the lists', async () => {
    const { service } = createHarness();
    await expect(
      service.createVisit(validVisit('token', { preferred_make: 'Jindal' })),
    ).rejects.toThrow('Select a preferred brand from the list.');
    await expect(
      service.createVisit(validVisit('token', { payment_terms: '90 Days' })),
    ).rejects.toThrow('Select a payment term.');
  });

  it('returns the 24-hour window message when WhatsApp rejects the send', async () => {
    const { service, tables } = createHarness();
    jest.spyOn(visitOtp, 'sendVisitOtpWhatsApp').mockRejectedValue({
      response: {
        data: {
          error: {
            code: 131047,
            error_subcode: 2494010,
            message: 'Re-engagement message for 919822012345',
          },
        },
      },
    });

    await expect(service.requestVisitOtp('9822012345')).rejects.toThrow(
      'This number has not messaged Enlight Metals on WhatsApp in the last 24 hours. Ask them to send any message to the business number, then request the code again.',
    );
    expect(tables.visit_phone_verifications).toHaveLength(1);
    expect(tables.visit_phone_verifications[0].consumed_at).toBeTruthy();
    expect(
      describeVisitWhatsAppFailure({
        response: {
          data: { error: { code: 131026, message: 'Message undeliverable' } },
        },
      }).userMessage,
    ).toBe('This number could not be reached on WhatsApp.');
    expect(
      describeVisitWhatsAppFailure({
        response: {
          data: {
            error: {
              code: 131030,
              message: 'Recipient 919822012345 is not in the allowed list',
            },
          },
        },
      }),
    ).toMatchObject({
      code: '131030',
      metaMessage: 'Recipient **** is not in the allowed list',
      userMessage:
        'The visit code could not be sent on WhatsApp (code 131030): Recipient **** is not in the allowed list.',
    });
    expect(
      describeVisitWhatsAppFailure({
        response: {
          data: {
            error: {
              code: 100,
              message: '(#131047) Re-engagement message',
            },
          },
        },
      }).userMessage,
    ).toBe(
      'This number has not messaged Enlight Metals on WhatsApp in the last 24 hours. Ask them to send any message to the business number, then request the code again.',
    );
  });

  it('saves a manual city and keeps the GPS photo coordinates', async () => {
    const { service, tables } = createHarness();
    await service.requestVisitOtp('9822012345');
    tables.visit_phone_verifications[0].created_at = new Date(
      Date.now() - 120000,
    ).toISOString();
    const verified = await service.verifyVisitOtp('9822012345', '123456');
    const created = await service.createVisit(
      validVisit(verified.verification_token, {
        location_source: 'manual',
        location: 'Chakan',
        visit_latitude: null,
        visit_longitude: null,
      }),
      '919822011111',
    );

    expect(created.phone_verified).toBe(true);
    expect(created.location_source).toBe('manual');
    expect(created.visit_latitude).toBeNull();
    expect(created.gps_latitude).toBe(18.52);
    expect(created.preferred_make).toBe('TATA, Others');
    expect(created.preferred_make_other).toBe('Local mill');
    expect(tables.visit_phone_verifications[0].consumed_at).toBeTruthy();
  });
});

// Issue: <add GitHub issue link>
// A temporary flag returns the visit code without WhatsApp.
import { KraService } from '../modules/kra/kra.service';
import * as visitOtp from '../modules/kra/visit-verification';

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function createHarness() {
  const tables: Record<string, any[]> = {
    visit_phone_verifications: [],
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
  return { service };
}

describe('visit otp test mode', () => {
  const previous = {
    mode: process.env.VISIT_OTP_TEST_MODE,
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    template: process.env.WHATSAPP_VISIT_OTP_TEMPLATE,
  };

  afterEach(() => {
    restoreEnv('VISIT_OTP_TEST_MODE', previous.mode);
    restoreEnv('WHATSAPP_TOKEN', previous.token);
    restoreEnv('WHATSAPP_PHONE_NUMBER_ID', previous.phoneNumberId);
    restoreEnv('WHATSAPP_VISIT_OTP_TEMPLATE', previous.template);
    jest.restoreAllMocks();
  });

  it('returns the code without calling WhatsApp when the flag is on', async () => {
    process.env.VISIT_OTP_TEST_MODE = 'true';
    const send = jest.spyOn(visitOtp, 'sendVisitOtpWhatsApp').mockResolvedValue();
    const { service } = createHarness();

    const result = await service.requestVisitOtp('9822012345');

    expect(send).not.toHaveBeenCalled();
    expect(result.test_otp).toMatch(/^\d{6}$/);
    await expect(service.verifyVisitOtp('9822012345', result.test_otp!)).resolves.toMatchObject({
      message: 'Phone verified.',
    });
  });

  it('still reports that WhatsApp is not configured when the flag is off', async () => {
    delete process.env.VISIT_OTP_TEST_MODE;
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_VISIT_OTP_TEMPLATE;
    const { service } = createHarness();

    await expect(service.requestVisitOtp('9822012345')).rejects.toThrow(
      'WhatsApp is not configured for visit codes.',
    );
  });
});

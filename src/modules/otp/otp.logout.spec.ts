import { OtpService } from './otp.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../../test-utils/supabase.mock';

const employee = {
  id: 'uuid-1',
  employee_id: 'EMP-1',
  name: 'Asha',
  phone: '919800000001',
  role: 'salesperson',
};

const setup = () => {
  const db = createSupabaseMock({
    tables: {
      otp_sessions: [
        {
          id: 'otp-1',
          phone: employee.phone,
          otp: '123456',
          verified: false,
          expires_at: '2099-01-01T00:00:00.000Z',
        },
      ],
      activity_logs: [],
      employees: [],
    },
  });
  const client = asSupabaseService(db.client);
  const logs = new ActivityLogsService(client);
  const jwt = {
    sign: jest.fn((payload: any) => `tok.${payload.sid}`),
    verify: jest.fn(),
  };
  const employees = { findByPhone: jest.fn(async () => employee) };
  const service = new OtpService(client, employees as any, jwt as any, logs);
  return { db, service, jwt, logs };
};

describe('OTP login and logout logs', () => {
  it('writes one Auth login row after a successful OTP', async () => {
    const { db, service, jwt, logs } = setup();
    const spy = jest.spyOn(logs, 'logActivity');

    const result = await service.verifyOtp(employee.phone, '123456');
    await spy.mock.results[0].value;

    expect(result.token).toContain('tok.');
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ sid: expect.any(String), name: 'Asha' }),
    );
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'Auth',
        action_type: 'login',
        description: 'Login',
        entity_id: jwt.sign.mock.calls[0][0].sid,
        change_detail: { employee_id: 'EMP-1' },
      }),
    );
    expect(db.store.activity_logs).toHaveLength(1);
  });

  it('ignores a bad signature and a token with no session id', async () => {
    const { db, service, jwt } = setup();
    jwt.verify.mockImplementation((token: string) => {
      if (token === 'bad') throw new Error('bad signature');
      return { phone: employee.phone, name: employee.name };
    });

    await service.recordLogout('bad', 'manual');
    await service.recordLogout('nosid', 'manual');

    expect(db.store.activity_logs).toHaveLength(0);
  });

  it('writes one logout per session id', async () => {
    const { db, service, jwt } = setup();
    jwt.verify.mockReturnValue({
      sid: 'sid-1',
      phone: employee.phone,
      name: employee.name,
      employee_id: employee.employee_id,
    });

    await service.recordLogout('tok', 'manual');
    await service.recordLogout('tok', 'session_expired');

    const logouts = db.store.activity_logs.filter(
      (row) => row.action_type === 'logout',
    );
    expect(logouts).toHaveLength(1);
    expect(logouts[0].description).toBe('Logout');
    expect(logouts[0].entity_id).toBe('sid-1');
    expect(logouts[0].change_detail).toEqual({
      reason: 'manual',
      employee_id: 'EMP-1',
    });
  });

  it('names the employee when the session expires', async () => {
    const { db, service, jwt } = setup();
    jwt.verify.mockReturnValue({
      sid: 'sid-2',
      phone: employee.phone,
      name: employee.name,
      employee_id: employee.employee_id,
    });

    await service.recordLogout('tok', 'session_expired');

    const logouts = db.store.activity_logs.filter(
      (row) => row.action_type === 'logout',
    );
    expect(logouts).toHaveLength(1);
    expect(logouts[0].description).toBe(
      'Session expired. Asha (EMP-1) logged out.',
    );
  });
});

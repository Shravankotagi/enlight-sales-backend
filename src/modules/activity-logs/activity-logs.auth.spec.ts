import { ActivityLogsService } from './activity-logs.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../../test-utils/supabase.mock';

describe('ActivityLogsService auth rows', () => {
  it('hides Auth rows from anyone who is not an admin', async () => {
    const db = createSupabaseMock({
      tables: {
        activity_logs: [
          {
            module: 'Inquiries',
            action_type: 'activity',
            description: 'Saved',
          },
        ],
      },
    });
    const service = new ActivityLogsService(asSupabaseService(db.client));

    await service.getActivityLogs({}, null, { includeAuth: false });

    expect(db.calls[0].modifiers).toEqual(
      expect.arrayContaining([
        ['or', ['module.is.null,module.not.in.(Auth,Employees)']],
      ]),
    );
  });

  it('pairs a login with its logout and leaves an open session unmarked', async () => {
    const db = createSupabaseMock({
      tables: {
        activity_logs: [
          {
            action_type: 'login',
            entity_id: 's1',
            module: 'Auth',
            timestamp: '2026-10-14T10:00:00.000Z',
          },
          {
            action_type: 'logout',
            entity_id: 's1',
            module: 'Auth',
            timestamp: '2026-10-14T10:37:00.000Z',
            change_detail: { reason: 'manual' },
          },
          {
            action_type: 'login',
            entity_id: 's2',
            module: 'Auth',
            timestamp: '2026-10-14T11:00:00.000Z',
          },
          {
            action_type: 'login',
            entity_id: 's3',
            module: 'Auth',
            timestamp: '2026-10-14T12:00:00.000Z',
          },
          {
            action_type: 'logout',
            entity_id: 's3',
            module: 'Auth',
            timestamp: '2026-10-14T12:05:00.000Z',
            change_detail: { reason: 'session_expired' },
          },
        ],
      },
    });
    const service = new ActivityLogsService(asSupabaseService(db.client));

    const rows: any[] = await service.getActivityLogs(
      { module: 'Auth' },
      null,
      { includeAuth: true },
    );
    const login = (sid: string) =>
      rows.find((row) => row.entity_id === sid && row.action_type === 'login');

    expect(login('s1').duration_minutes).toBe(37);
    expect(login('s1').logout_status).toBe('Logout');
    expect(login('s2').logout_status).toBe('No logout recorded');
    expect(login('s2').logout_at).toBeNull();
    expect(login('s2').duration_minutes).toBeNull();
    expect(login('s3').logout_status).toBe('Session expired');
    expect(login('s3').duration_minutes).toBe(5);
  });

  it('hides zoho_sync rows when accessiblePhones is provided (salesperson/manager scope)', async () => {
    const db = createSupabaseMock({
      tables: {
        activity_logs: [
          {
            module: 'Customers',
            source: 'zoho_sync',
            salesperson_phone: null,
            description: 'Zoho Bigin Customers Sync',
          },
          {
            module: 'Inquiries',
            source: 'manual',
            salesperson_phone: '919876543210',
            description: 'Saved Inquiry',
          },
        ],
      },
    });
    const service = new ActivityLogsService(asSupabaseService(db.client));

    const rows = await service.getActivityLogs({}, ['9876543210']);

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: 'Saved Inquiry' }),
      ]),
    );
    expect(rows.some((r) => r.source === 'zoho_sync')).toBe(false);
  });
});

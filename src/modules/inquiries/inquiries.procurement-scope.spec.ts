import { ForbiddenException } from '@nestjs/common';
import { InquiriesService, matchesProcurementScope } from './inquiries.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../../test-utils/supabase.mock';

const inquiry = (
  id: string,
  status: string,
  procurement_employee_id: string | null,
) => ({
  id,
  status,
  procurement_employee_id,
  inquiry_type: 'inquiry',
  source_channel: 'dashboard',
  raw_text: 'Need 10 MT steel',
  created_at: '2026-01-01T00:00:00.000Z',
  sender_phone: '919000000000',
});

describe('matchesProcurementScope', () => {
  const team = {
    ids: ['mgr', 'person'],
    includeUnassignedPool: true,
  };

  it('lets a manager see only inquiries stamped to their team', () => {
    expect(matchesProcurementScope(inquiry('1', 'new', 'person'), team)).toBe(
      true,
    );
    expect(matchesProcurementScope(inquiry('2', 'pending', null), team)).toBe(
      false,
    );
    expect(matchesProcurementScope(inquiry('3', 'won', null), team)).toBe(
      false,
    );
    expect(matchesProcurementScope(inquiry('4', 'lost', null), team)).toBe(
      false,
    );
    expect(matchesProcurementScope(inquiry('5', 'new', 'other'), team)).toBe(
      false,
    );
  });

  it('never shows the pool to a person, and empty ids match nothing', () => {
    const person = { ids: ['person'], includeUnassignedPool: false };
    expect(matchesProcurementScope(inquiry('1', 'new', null), person)).toBe(
      false,
    );
    expect(matchesProcurementScope(inquiry('2', 'new', 'person'), person)).toBe(
      true,
    );
    expect(
      matchesProcurementScope(inquiry('3', 'new', 'person'), {
        ids: [],
        includeUnassignedPool: false,
      }),
    ).toBe(false);
  });
});

describe('InquiriesService procurement scope', () => {
  const rows = [
    inquiry('mine', 'review', 'person'),
    inquiry('team', 'new', 'mgr'),
    inquiry('pool', 'draft', null),
    inquiry('old', 'won', null),
    inquiry('other', 'pending', 'stranger'),
  ];

  const createService = () => {
    const db = createSupabaseMock({
      tables: {
        inquiries: rows,
        deals: [],
        employees: [],
        recurring_customers: [],
      },
    });
    const service = new InquiriesService(
      asSupabaseService(db.client),
      {} as any,
      { logActivity: () => undefined } as any,
      {} as any,
    );
    return service;
  };

  it('returns stamped team rows for a manager, without throwing on empty ids', async () => {
    const service = createService();
    const managerRows = await service.findAll({
      procurementScope: { ids: ['mgr', 'person'], includeUnassignedPool: false },
    });
    expect(managerRows.map((row: any) => row.id).sort()).toEqual(
      ['mine', 'team'].sort(),
    );

    const empty = await service.findAll({
      procurementScope: { ids: [], includeUnassignedPool: false },
    });
    expect(empty).toEqual([]);
  });

  it('refuses a terminal status and refuses deleting an unassigned pool row', async () => {
    const service = createService();
    const scope = { ids: ['mgr', 'person'], includeUnassignedPool: true };

    await expect(
      service.updateStatus('pool', 'confirmed', { lineItems: [] }, null, scope),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.deleteInquiry('pool', null, {
        ...scope,
        includeUnassignedPool: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

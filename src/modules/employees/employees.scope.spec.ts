import { ForbiddenException, BadRequestException } from '@nestjs/common';
import {
  EmployeesService,
  normalizePhone,
  phoneInList,
  phoneMatches,
} from './employees.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../../test-utils/supabase.mock';

const employees = [
  { id: 'admin-1', phone: '9000000000', role: 'admin', is_active: true },
  {
    id: 'mgr-1',
    phone: '9100000000',
    role: 'sales_manager',
    is_active: true,
  },
  {
    id: 'sp-1',
    phone: '9200000001',
    role: 'salesperson',
    manager_id: 'mgr-1',
    is_active: true,
  },
  {
    id: 'sp-2',
    phone: '9200000002',
    role: 'salesperson',
    manager_phone: '+91 91000 00000',
    is_active: true,
  },
  {
    id: 'sp-3',
    phone: '9300000003',
    role: 'salesperson',
    manager_id: 'other-mgr',
    is_active: true,
  },
  {
    id: 'pm-1',
    phone: '9400000000',
    role: 'procurement_manager',
    is_active: true,
  },
  {
    id: 'pp-1',
    phone: '9400000001',
    role: 'procurement_person',
    manager_id: 'pm-1',
    is_active: true,
  },
  {
    id: 'pp-sales',
    phone: '9400000002',
    role: 'procurement_person',
    manager_id: 'mgr-1',
    is_active: true,
  },
  {
    id: 'sp-routed',
    phone: '9500000005',
    role: 'salesperson',
    is_active: true,
    assigned_procurement_employee_id: 'pp-1',
  },
];

const createService = () =>
  new EmployeesService(
    asSupabaseService(createSupabaseMock({ tables: { employees } }).client),
  );

describe('phone helpers', () => {
  it('normalizes to the last 10 digits', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('9876543210');
    expect(normalizePhone(undefined)).toBe('');
  });

  it('matches phones across formats', () => {
    expect(phoneMatches('+919876543210', '98765 43210')).toBe(true);
    expect(phoneMatches('12345', '12345')).toBe(false);
    expect(phoneInList('919200000001', ['9200000001'])).toBe(true);
    expect(phoneInList('9200000001', [])).toBe(false);
  });
});

describe('EmployeesService.getAccessibleSalespersonPhones', () => {
  it('limits a salesperson strictly to their own phone, ignoring overrides', async () => {
    const service = createService();
    const salesperson = employees[2];

    await expect(
      service.getAccessibleSalespersonPhones(salesperson, '9300000003'),
    ).resolves.toEqual({ phones: ['9200000001'] });
  });

  it('gives a manager their team (by manager id and manager phone) plus themselves', async () => {
    const service = createService();
    const result = await service.getAccessibleSalespersonPhones(employees[1]);

    expect(result.isManagerView).toBe(true);
    expect(result.phones?.sort()).toEqual(
      ['9100000000', '9200000001', '9200000002'].sort(),
    );
  });

  it('forbids a manager from viewing a salesperson outside their team', async () => {
    const service = createService();

    await expect(
      service.getAccessibleSalespersonPhones(employees[1], '9300000003'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a manager drill into one team member', async () => {
    const service = createService();

    await expect(
      service.getAccessibleSalespersonPhones(employees[1], '9200000002'),
    ).resolves.toEqual({ phones: ['9200000002'] });
  });

  it('gives an admin unrestricted access and team expansion for a manager override', async () => {
    const service = createService();

    await expect(
      service.getAccessibleSalespersonPhones(employees[0]),
    ).resolves.toEqual({ phones: null });

    const managerView = await service.getAccessibleSalespersonPhones(
      employees[0],
      '9100000000',
    );
    expect(managerView.isManagerView).toBe(true);
    expect(managerView.phones).toContain('9200000001');
    expect(managerView.phones).not.toContain('9400000002');
  });

  it('narrows an all-scope user to their own phone in personal mode', async () => {
    const service = createService();
    await expect(
      service.getAccessibleSalespersonPhones(
        { ...employees[0], dataScope: 'all' },
        undefined,
        'personal',
      ),
    ).resolves.toEqual({ phones: ['9000000000'], isPersonalView: true });
  });

  it('ignores a phone override for an own-scope user', async () => {
    const service = createService();
    await expect(
      service.getAccessibleSalespersonPhones(
        { ...employees[2], dataScope: 'own' },
        '9300000003',
      ),
    ).resolves.toEqual({ phones: ['9200000001'] });
  });

  it('adds selected inquiry owners and keeps a checked visit scope own-only', async () => {
    const service = createService();
    const user = {
      ...employees[2],
      dataScope: 'own',
      permissions: {
        'inquiries.scope_assigned': false,
        'visits.scope_assigned': true,
      },
      visibilityScope: { inquiries: ['sp-3'], visits: ['sp-3'] },
    };

    await expect(
      service.getAccessibleSalespersonPhones(
        user,
        undefined,
        undefined,
        'inquiries.scope_assigned',
      ),
    ).resolves.toEqual({ phones: ['9200000001', '9300000003'] });

    await expect(
      service.getAccessibleSalespersonPhones(
        user,
        undefined,
        undefined,
        'visits.scope_assigned',
      ),
    ).resolves.toEqual({ phones: ['9200000001'] });
  });
});

describe('EmployeesService procurement scope', () => {
  it('gives a procurement manager their team ids without an unassigned pool', async () => {
    const service = createService();
    const scope = await service.getAccessibleProcurementIds(employees[5]);

    expect(scope.includeUnassignedPool).toBe(false);
    expect(scope.ids.sort()).toEqual(['pm-1', 'pp-1'].sort());
    expect(scope.salespersonPhones).toEqual(['9500000005']);
    expect(scope.salespersonEmployeeIds).toEqual(['sp-routed']);
  });

  it('limits a procurement person to their own id', async () => {
    const service = createService();
    await expect(
      service.getAccessibleProcurementIds(employees[6]),
    ).resolves.toEqual({
      ids: ['pp-1'],
      includeUnassignedPool: false,
      salespersonPhones: ['9500000005'],
      salespersonEmployeeIds: ['sp-routed'],
    });
  });

  it('rejects a salesperson assigned to a procurement manager', async () => {
    const service = createService();
    await expect(
      service.create({
        employee_id: 'EMP-NEW',
        name: 'New Rep',
        phone: '9500000001',
        role: 'salesperson',
        manager_id: 'pm-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('leaves an existing manager link alone when only the active flag changes', async () => {
    employees[1].manager_id = 'keep-me';
    try {
      const service = createService();
      const updated = await service.update('mgr-1', { is_active: true });
      expect(updated.manager_id).toBe('keep-me');
    } finally {
      delete employees[1].manager_id;
    }
  });

  it('returns the full directory when staff view is on, and only self when it is off', async () => {
    const service = createService();
    const viewer = {
      ...employees[2],
      permissions: { 'staff.view': true, 'staff.delete': true },
    };

    const everyone = await service.findAll(viewer);
    expect(everyone.map((row: any) => row.id)).toContain('admin-1');
    expect(everyone.map((row: any) => row.id)).toContain('sp-3');

    const selfOnly = await service.findAll(employees[2]);
    expect(selfOnly.map((row: any) => row.id)).toEqual(['sp-1']);
  });

  it('rejects a procurement person assigned to a sales manager', async () => {
    const service = createService();
    await expect(
      service.create({
        employee_id: 'EMP-PP',
        name: 'New Buyer',
        phone: '9500000002',
        role: 'procurement_person',
        manager_id: 'mgr-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

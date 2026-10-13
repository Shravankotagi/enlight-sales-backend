import { ForbiddenException } from '@nestjs/common';
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
  });
});

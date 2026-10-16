import { EmployeesService } from './employees.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../../test-utils/supabase.mock';

const target = {
  id: 'emp-1',
  employee_id: 'EMP012',
  name: 'Ravi Kumar',
  phone: '919800000012',
  role: 'salesperson',
  is_active: true,
};

const caller = { phone: '919800000001', name: 'Admin' };

const setup = (employee = target) => {
  const db = createSupabaseMock({
    tables: { employees: [{ ...employee }] },
  });
  const logs = { logActivity: jest.fn() };
  const service = new EmployeesService(
    asSupabaseService(db.client),
    logs as any,
  );
  return { db, logs, service };
};

describe('employee lifecycle logs', () => {
  it('logs a deactivation when an active employee is set inactive', async () => {
    const { logs, service } = setup();

    await service.update('emp-1', { is_active: false }, caller);

    expect(logs.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'Employees',
        action_type: 'employee_deactivated',
        entity_id: 'emp-1',
        salesperson_name: 'Admin',
        description: 'Deactivated Ravi Kumar (EMP012)',
      }),
    );
  });

  it('does not log when an already active employee is saved as active', async () => {
    const { logs, service } = setup();

    await service.update('emp-1', { is_active: true }, caller);

    expect(logs.logActivity).not.toHaveBeenCalled();
  });

  it('logs a delete with the target name', async () => {
    const { logs, service } = setup();

    await service.delete('emp-1', caller);

    expect(logs.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'Employees',
        action_type: 'employee_deleted',
        description: 'Deleted Ravi Kumar (EMP012)',
        change_detail: expect.objectContaining({
          target_name: 'Ravi Kumar',
          target_employee_id: 'EMP012',
        }),
      }),
    );
  });
});

import { ForbiddenException } from '@nestjs/common';
import { PermissionGuard, hasPermission } from './permission.guard';
import { canReadDealLists } from '../../modules/deals/deals.controller';

describe('PermissionGuard', () => {
  const guard = new PermissionGuard({
    getAllAndOverride: () => ['visits.delete'],
  } as any);

  const activate = (employee: any) =>
    guard.canActivate({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ employee }) }),
    } as any);

  it('lets internal bot calls through without an employee row', () => {
    expect(activate({ isInternal: true, employee_id: 'bot-internal' })).toBe(
      true,
    );
    expect(hasPermission({ isInternal: true }, 'visits.delete')).toBe(true);
  });

  it('denies a user who does not have the key', () => {
    expect(() => activate({ permissions: { 'visits.view': true } })).toThrow(
      ForbiddenException,
    );
  });

  it('allows a user who has the key', () => {
    expect(activate({ permissions: { 'visits.delete': true } })).toBe(true);
  });

  it('allows an admin without explicit permission keys', () => {
    expect(activate({ role: 'admin' })).toBe(true);
    expect(hasPermission({ role: 'admin' }, 'visits.delete')).toBe(true);
    expect(activate({ role: 'super_admin' })).toBe(true);
    expect(hasPermission({ role: 'super_admin' }, 'staff.manage_acl')).toBe(
      true,
    );
  });

  it('hides deal lists from a customer-only user', () => {
    expect(canReadDealLists({ permissions: { 'customers.view': true } })).toBe(
      false,
    );
    expect(canReadDealLists({ permissions: { 'orders.view': true } })).toBe(
      true,
    );
    expect(canReadDealLists({ role: 'admin' })).toBe(true);
  });
});

import { ForbiddenException } from '@nestjs/common';
import { PermissionGuard, hasPermission } from './permission.guard';

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
});

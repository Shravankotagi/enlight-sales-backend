import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { RoleGuard } from './role.guard';

const contextFor = (user: any): ExecutionContext =>
  ({
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as any;

const reflectorReturning = (roles: string[] | undefined) =>
  ({
    getAllAndOverride: () => roles,
    get: () => roles,
  }) as unknown as Reflector;

describe('RolesGuard', () => {
  it('allows any request when no roles are required', () => {
    const guard = new RolesGuard(reflectorReturning(undefined));
    expect(guard.canActivate(contextFor(null))).toBe(true);
  });

  it('denies a request without a user', () => {
    const guard = new RolesGuard(reflectorReturning(['admin']));
    expect(guard.canActivate(contextFor(null))).toBe(false);
  });

  it('accepts the role from user metadata or the user record', () => {
    const guard = new RolesGuard(reflectorReturning(['admin']));
    expect(
      guard.canActivate(contextFor({ user_metadata: { role: 'admin' } })),
    ).toBe(true);
    expect(guard.canActivate(contextFor({ role: 'admin' }))).toBe(true);
    expect(guard.canActivate(contextFor({ role: 'salesperson' }))).toBe(false);
  });
});

describe('RoleGuard', () => {
  it('allows any request when no roles are required', async () => {
    const guard = new RoleGuard(reflectorReturning(undefined));
    await expect(guard.canActivate(contextFor(null))).resolves.toBe(true);
  });

  it('rejects a user without a role', async () => {
    const guard = new RoleGuard(reflectorReturning(['admin']));
    await expect(guard.canActivate(contextFor({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a user whose role is not allowed', async () => {
    const guard = new RoleGuard(reflectorReturning(['admin']));
    await expect(
      guard.canActivate(contextFor({ user_metadata: { role: 'salesperson' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a user whose role is allowed', async () => {
    const guard = new RoleGuard(reflectorReturning(['admin']));
    await expect(
      guard.canActivate(contextFor({ user_metadata: { role: 'admin' } })),
    ).resolves.toBe(true);
  });
});

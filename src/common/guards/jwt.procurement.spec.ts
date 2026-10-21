import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard, isProcurementRequestAllowed } from './jwt.guard';
import { JWT_SIGNING_SECRET } from '../auth/jwt-secret';

describe('isProcurementRequestAllowed', () => {
  it('allows inquiries, including an /api prefix', () => {
    expect(isProcurementRequestAllowed('GET', '/inquiries')).toBe(true);
    expect(isProcurementRequestAllowed('POST', '/api/inquiries')).toBe(true);
    expect(isProcurementRequestAllowed('GET', '/api/v1/inquiries/abc')).toBe(
      true,
    );
  });

  it('allows the assistant message and session routes', () => {
    expect(isProcurementRequestAllowed('POST', '/chat/message')).toBe(true);
    expect(isProcurementRequestAllowed('GET', '/chat/sessions')).toBe(true);
    expect(isProcurementRequestAllowed('POST', '/chat/sessions')).toBe(true);
    expect(
      isProcurementRequestAllowed('GET', '/chat/sessions/abc/messages'),
    ).toBe(true);
  });

  it('denies lookalike paths, the knowledge base, deals, and non-GET catalog routes', () => {
    expect(isProcurementRequestAllowed('GET', '/inquiries-x')).toBe(false);
    expect(isProcurementRequestAllowed('GET', '/chat/kb/documents')).toBe(
      false,
    );
    expect(isProcurementRequestAllowed('POST', '/chat/kb/upload')).toBe(false);
    expect(isProcurementRequestAllowed('GET', '/deals')).toBe(false);
    expect(isProcurementRequestAllowed('POST', '/products')).toBe(false);
  });

  it('allows read-only products, pricing, and the employee list', () => {
    expect(isProcurementRequestAllowed('GET', '/products')).toBe(true);
    expect(isProcurementRequestAllowed('GET', '/pricing/rates')).toBe(true);
    expect(isProcurementRequestAllowed('GET', '/employees')).toBe(true);
    expect(isProcurementRequestAllowed('PATCH', '/employees/1')).toBe(false);
  });
});

describe('JwtAuthGuard procurement allowlist', () => {
  const guardFor = (payload: any) =>
    new JwtAuthGuard({ verify: () => payload } as any);

  const activate = (guard: JwtAuthGuard, method: string, path: string) => {
    const request: any = {
      headers: { authorization: 'Bearer token' },
      method,
      path,
    };
    return guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
    } as any);
  };

  it('rejects a procurement token on a blocked route', async () => {
    const guard = guardFor({ role: 'procurement_manager' });
    await expect(activate(guard, 'GET', '/deals')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows a procurement token on inquiries and leaves other roles alone', async () => {
    const procurement = guardFor({ role: 'procurement_person' });
    await expect(activate(procurement, 'GET', '/inquiries')).resolves.toBe(
      true,
    );

    const salesperson = guardFor({ role: 'salesperson' });
    await expect(activate(salesperson, 'GET', '/deals')).resolves.toBe(true);
  });
});

describe('JwtAuthGuard salesperson token', () => {
  const salesperson = {
    id: 'sp-1',
    role: 'salesperson',
    roleName: 'Salesperson',
    phone: '919200000001',
    employee_id: 'E2',
    name: 'Sam',
    dataScope: 'own' as const,
    permissions: { 'customers.view': true },
    isActive: true,
  };

  it('accepts a token signed with the OTP secret', async () => {
    const jwt = new JwtService({ secret: JWT_SIGNING_SECRET });
    const token = jwt.sign({
      id: salesperson.id,
      role: 'salesperson',
      phone: salesperson.phone,
      employee_id: salesperson.employee_id,
      name: salesperson.name,
    });
    const request: any = {
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      path: '/kra/dashboard',
    };
    const guard = new JwtAuthGuard(jwt, {
      resolveFromToken: async () => salesperson,
    } as any);
    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      } as any),
    ).resolves.toBe(true);
    expect(request.employee.role).toBe('salesperson');
  });

  it('does not turn a resolve failure into 401', async () => {
    const guard = new JwtAuthGuard(
      { verify: () => ({ id: 'sp-1', role: 'salesperson' }) } as any,
      {
        resolveFromToken: async () => {
          throw new ServiceUnavailableException('db down');
        },
      } as any,
    );
    const request: any = {
      headers: { authorization: 'Bearer token' },
      method: 'GET',
      path: '/kra/dashboard',
    };
    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      } as any),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      } as any),
    ).rejects.not.toBeInstanceOf(UnauthorizedException);
  });
});

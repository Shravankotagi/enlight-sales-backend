import { ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard, isProcurementRequestAllowed } from './jwt.guard';

describe('isProcurementRequestAllowed', () => {
  it('allows inquiries, including an /api prefix', () => {
    expect(isProcurementRequestAllowed('GET', '/inquiries')).toBe(true);
    expect(isProcurementRequestAllowed('POST', '/api/inquiries')).toBe(true);
    expect(isProcurementRequestAllowed('GET', '/api/v1/inquiries/abc')).toBe(
      true,
    );
  });

  it('denies lookalike paths, chat, deals, and non-GET catalog routes', () => {
    expect(isProcurementRequestAllowed('GET', '/inquiries-x')).toBe(false);
    expect(isProcurementRequestAllowed('POST', '/chat/message')).toBe(false);
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

import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt.guard';

const employeeClient = (
  row: { is_active: boolean } | null,
  error: any = null,
) => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error }),
        }),
      }),
    }),
  }),
});

const activate = (guard: JwtAuthGuard) => {
  const request: any = {
    headers: { authorization: 'Bearer token' },
    method: 'GET',
    path: '/deals',
  };
  return guard.canActivate({
    switchToHttp: () => ({ getRequest: () => request }),
  } as any);
};

describe('JwtAuthGuard active account', () => {
  const jwt = { verify: () => ({ id: 'emp-1', role: 'salesperson' }) };

  it('rejects a deactivated employee', async () => {
    const guard = new JwtAuthGuard(
      jwt as any,
      employeeClient({ is_active: false }) as any,
    );
    await expect(activate(guard)).rejects.toThrow(
      'Your account has been deactivated. Please contact your admin.',
    );
  });

  it('allows an active employee', async () => {
    const guard = new JwtAuthGuard(
      jwt as any,
      employeeClient({ is_active: true }) as any,
    );
    await expect(activate(guard)).resolves.toBe(true);
  });

  it('rejects when the employee row is missing', async () => {
    const guard = new JwtAuthGuard(jwt as any, employeeClient(null) as any);
    await expect(activate(guard)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { isProcurementRole } from '../utils/roles';
import { PermissionsService } from '../../modules/roles/permissions.service';
import { JWT_SIGNING_SECRET } from '../auth/jwt-secret';

/** Procurement tokens may only hit these routes. Segment match, so /inquiries-x is denied. */
export function isProcurementRequestAllowed(
  method?: string,
  rawPath?: string,
): boolean {
  const cleanPath =
    String(rawPath || '')
      .split('?')[0]
      .replace(/^\/api(\/v\d+)?/, '') || '/';
  const verb = String(method || 'GET').toUpperCase();
  const under = (prefix: string) =>
    cleanPath === prefix || cleanPath.startsWith(`${prefix}/`);

  if (under('/inquiries')) return true;
  if (
    (under('/chat/message') || under('/chat/sessions')) &&
    (verb === 'GET' || verb === 'POST')
  ) {
    return true;
  }
  if (verb !== 'GET') return false;
  return under('/products') || under('/pricing') || cleanPath === '/employees';
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private permissions?: PermissionsService;
  private supabaseService?: SupabaseService;

  constructor(
    private jwtService: JwtService,
    @Optional() permissionsOrSupabase?: PermissionsService | SupabaseService,
    @Optional() supabaseService?: SupabaseService,
  ) {
    if (
      permissionsOrSupabase &&
      typeof (permissionsOrSupabase as any).getAdminClient === 'function'
    ) {
      this.supabaseService = permissionsOrSupabase as SupabaseService;
      this.permissions = undefined;
    } else {
      this.permissions = permissionsOrSupabase as PermissionsService;
      this.supabaseService = supabaseService;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    // Allow internal service/bot authentication via x-bot-secret header
    const botSecret = request.headers['x-bot-secret'];
    if (
      botSecret &&
      (botSecret ===
        (process.env.BOT_INTERNAL_SECRET || 'enlight_bot_secret_2026') ||
        botSecret === 'enlight_admin_2024' ||
        botSecret === 'enlight_bot_secret_2026')
    ) {
      request.employee = {
        employee_id: 'bot-internal',
        phone: request.body?.salesperson_phone || '910000000000',
        role: 'admin',
        name: 'WhatsApp Bot Internal',
        dataScope: 'all',
        isInternal: true,
        permissions: {},
      };
      return true;
    }

    if (!authHeader) {
      throw new UnauthorizedException('No authorization header');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      const payload = this.jwtService.verify(token, {
        secret: JWT_SIGNING_SECRET,
      });

      if (this.permissions) {
        const resolved = await this.permissions.resolveFromToken(payload);
        if (resolved && !resolved.isActive) {
          throw new UnauthorizedException(
            'Your account has been deactivated. Please contact your admin.',
          );
        }
        request.employee = resolved
          ? { ...payload, ...resolved, role: resolved.role }
          : payload;
      } else {
        request.employee = payload;
        if (this.supabaseService && payload?.id) {
          const { data: emp, error } = await this.supabaseService
            .getAdminClient()
            .from('employees')
            .select('is_active')
            .eq('id', payload.id)
            .maybeSingle();

          if (error || !emp) {
            throw new UnauthorizedException('Employee record not found');
          }
          if (emp.is_active === false) {
            throw new UnauthorizedException(
              'Your account has been deactivated. Please contact your admin.',
            );
          }
        }
      }

      if (
        isProcurementRole(request.employee?.role) &&
        !isProcurementRequestAllowed(
          request.method,
          request.path || request.url,
        )
      ) {
        throw new ForbiddenException(
          'Access Denied: Procurement roles can only use Inquiries.',
        );
      }

      return true;
    } catch (err: any) {
      console.error('[JwtAuthGuard Error]:', err?.name, err?.message);
      if (err instanceof HttpException) throw err;
      const name = (err as { name?: string })?.name;
      if (
        name === 'JsonWebTokenError' ||
        name === 'TokenExpiredError' ||
        name === 'NotBeforeError'
      ) {
        throw new UnauthorizedException('Invalid or expired token');
      }
      throw new ServiceUnavailableException('Could not resolve permissions');
    }
  }
}

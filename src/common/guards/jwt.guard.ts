import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { isProcurementRole } from '../utils/roles';

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
  constructor(
    private jwtService: JwtService,
    @Optional() private supabaseService?: SupabaseService,
  ) {}

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
        secret: process.env.JWT_SECRET || 'enlight-sales-jwt-secret-2026',
      });
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

      if (
        isProcurementRole(payload?.role) &&
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
      if (
        err instanceof UnauthorizedException ||
        err instanceof ForbiddenException
      ) {
        throw err;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

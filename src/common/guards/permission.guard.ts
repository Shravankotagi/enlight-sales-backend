import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';

export function hasPermission(employee: any, key: string): boolean {
  if (employee?.isInternal) return true;
  if (employee?.role === 'admin' || employee?.role === 'super_admin')
    return true;
  return employee?.permissions?.[key] === true;
}

export function assertPermission(employee: any, key: string) {
  if (!hasPermission(employee, key)) {
    throw new ForbiddenException(
      'Access Denied: you do not have permission for this action.',
    );
  }
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const keys = this.reflector.getAllAndOverride<string[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!keys?.length) return true;
    const employee = context.switchToHttp().getRequest()?.employee;
    if (employee?.isInternal) return true;
    if (employee?.role === 'admin' || employee?.role === 'super_admin')
      return true;
    if (keys.some((key) => employee?.permissions?.[key] === true)) return true;
    throw new ForbiddenException(
      'Access Denied: you do not have permission for this action.',
    );
  }
}

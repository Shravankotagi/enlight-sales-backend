import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'required_permissions';

/** Any one of the keys is enough. Missing keys fail closed in PermissionGuard. */
export const RequirePermission = (...keys: string[]) =>
  SetMetadata(PERMISSION_KEY, keys);

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import {
  BUILTIN_ROLE_TEMPLATES,
  legacyDataScope,
  mergePermissions,
  normalizeRoleId,
} from '../../common/acl/permissionKeys';

export interface ResolvedAccess {
  id: string;
  employee_id?: string;
  phone?: string;
  name?: string;
  role: string;
  roleName: string;
  dataScope: 'own' | 'team' | 'all';
  permissions: Record<string, boolean>;
  isActive: boolean;
}

const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; value: ResolvedAccess }>();

/** A custom role must not be stuck with a full copy of the standard salesperson template. */
function ignoreCopiedSalespersonTemplate(
  roleId: string,
  overrides?: Record<string, boolean> | null,
) {
  if (!overrides || roleId === 'salesperson') return overrides;
  const base = BUILTIN_ROLE_TEMPLATES.salesperson;
  const keys = Object.keys(overrides);
  if (!keys.length) return null;
  const copied = keys.every(
    (key) =>
      typeof overrides[key] === 'boolean' && overrides[key] === base[key],
  );
  return copied ? null : overrides;
}

export function invalidatePermissions(employeeId?: string) {
  if (!employeeId) cache.clear();
  else cache.delete(employeeId);
}

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  async resolve(
    employeeId: string,
    forceFresh: boolean = false,
  ): Promise<ResolvedAccess | null> {
    if (!employeeId) return null;
    if (!forceFresh) {
      const hit = cache.get(employeeId);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    }

    const { data, error } = await this.supabase
      .from('employees')
      .select('id, employee_id, phone, name, role, permissions, is_active')
      .eq('id', employeeId)
      .maybeSingle();

    if (error) {
      this.logger.warn(`Permission resolve failed: ${error.message}`);
      throw new ServiceUnavailableException('Could not resolve permissions');
    }
    if (!data) return null;
    return this.toResolved(data, forceFresh);
  }

  /** id, then employee code, then phone. A database error throws; a miss returns null. */
  async resolveFromToken(payload: {
    id?: string;
    employee_id?: string;
    phone?: string;
  }): Promise<ResolvedAccess | null> {
    if (payload?.id) {
      const byId = await this.resolve(String(payload.id));
      if (byId) return byId;
    }
    if (payload?.employee_id) {
      const byCode = await this.findEmployee(
        'employee_id',
        payload.employee_id,
      );
      if (byCode) return byCode;
    }
    if (payload?.phone) {
      const digits = String(payload.phone).replace(/\D/g, '').slice(-10);
      if (digits) {
        const { data, error } = await this.supabase
          .from('employees')
          .select('id, employee_id, phone, name, role, permissions, is_active')
          .ilike('phone', `%${digits}`)
          .limit(5);
        if (error) {
          this.logger.warn(`Permission resolve failed: ${error.message}`);
          throw new ServiceUnavailableException(
            'Could not resolve permissions',
          );
        }
        const row = (data || []).find(
          (emp: any) =>
            String(emp.phone || '')
              .replace(/\D/g, '')
              .slice(-10) === digits,
        );
        if (row) return this.toResolved(row);
      }
    }
    return null;
  }

  private async findEmployee(column: 'employee_id', value: string) {
    const { data, error } = await this.supabase
      .from('employees')
      .select('id, employee_id, phone, name, role, permissions, is_active')
      .eq(column, value)
      .maybeSingle();
    if (error) {
      this.logger.warn(`Permission resolve failed: ${error.message}`);
      throw new ServiceUnavailableException('Could not resolve permissions');
    }
    if (!data) return null;
    return this.toResolved(data);
  }

  private async toResolved(
    data: any,
    forceFresh: boolean = false,
  ): Promise<ResolvedAccess> {
    if (!forceFresh) {
      const cached = data?.id ? cache.get(data.id) : undefined;
      if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    }
    const roleId = normalizeRoleId(data.role);
    const resolved = await this.permissionsForRole(
      roleId,
      ignoreCopiedSalespersonTemplate(roleId, data.permissions),
      data.id,
    );
    const value: ResolvedAccess = {
      id: data.id,
      employee_id: data.employee_id,
      phone: data.phone,
      name: data.name,
      role: roleId,
      roleName: resolved.roleName,
      dataScope: resolved.dataScope,
      permissions: resolved.permissions,
      isActive: data.is_active !== false,
    };
    if (data.id) cache.set(data.id, { at: Date.now(), value });
    return value;
  }

  /** Used when the roles table is missing or has no row for a legacy role string. */
  async permissionsForRole(
    roleId: string,
    overrides?: Record<string, boolean> | null,
    employeeId?: string,
  ): Promise<{
    permissions: Record<string, boolean>;
    dataScope: 'own' | 'team' | 'all';
    roleName: string;
  }> {
    const id = normalizeRoleId(roleId);
    const { data: roleRow, error } = await this.supabase
      .from('roles')
      .select('id, name, data_scope, permissions, is_active')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      // shortcut: a missing roles table uses built-in templates so the API stays up before the SQL is run
      this.logger.warn(
        `Roles lookup failed, using built-in template: ${error.message}`,
      );
      return this.builtin(id, overrides);
    }

    if (roleRow && roleRow.is_active === false) {
      this.logger.warn(
        `Inactive role ${id} for ${employeeId || 'unknown'}; salesperson fallback`,
      );
      return {
        permissions: mergePermissions(
          BUILTIN_ROLE_TEMPLATES.salesperson,
          overrides,
        ),
        dataScope: 'own',
        roleName: 'Salesperson',
      };
    }

    if (!roleRow) {
      if (!BUILTIN_ROLE_TEMPLATES[id]) {
        this.logger.warn(`Unknown role ${id}; salesperson fallback`);
      }
      return this.builtin(id, overrides);
    }

    const scope = roleRow.data_scope;
    const base =
      BUILTIN_ROLE_TEMPLATES[id] || BUILTIN_ROLE_TEMPLATES.salesperson;
    return {
      permissions: mergePermissions(roleRow.permissions, overrides, base),
      dataScope:
        scope === 'all' || scope === 'team' || scope === 'own' ? scope : 'own',
      roleName: roleRow.name || id,
    };
  }

  private builtin(roleId: string, overrides?: Record<string, boolean> | null) {
    const template =
      BUILTIN_ROLE_TEMPLATES[roleId] || BUILTIN_ROLE_TEMPLATES.salesperson;
    return {
      permissions: mergePermissions(template, overrides, template),
      dataScope: legacyDataScope(
        BUILTIN_ROLE_TEMPLATES[roleId] ? roleId : 'salesperson',
      ),
      roleName: roleId,
    };
  }
}

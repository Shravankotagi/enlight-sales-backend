import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import {
  BUILTIN_ROLE_TEMPLATES,
  PERMISSION_KEYS,
  ROLE_DATA_SCOPE,
  assertKnownPermissions,
  normalizeRoleId,
} from '../../common/acl/permissionKeys';
import {
  invalidatePermissions,
  cleanVisibilityScope,
} from './permissions.service';

const SYSTEM_ROLES = [
  {
    id: 'admin',
    name: 'Admin',
    description:
      'Full company-wide visibility, staff management, and system configuration.',
  },
  {
    id: 'sales_manager',
    name: 'Sales Manager',
    description:
      'Team supervisor for assigned sales reps, accounts, deals, and visits.',
  },
  {
    id: 'salesperson',
    name: 'Salesperson',
    description:
      'Field representative for own visits, inquiries, quotes, and orders.',
  },
  {
    id: 'procurement_manager',
    name: 'Procurement Manager',
    description:
      'Reviews inquiries and base purchase rates for the procurement team.',
  },
  {
    id: 'procurement_person',
    name: 'Procurement Person',
    description: 'Fills base purchase prices on inquiries assigned to them.',
  },
];

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  /** Clears the bot permission cache so WhatsApp/assistant pick up role changes. */
  private async invalidateBotPermissionCache() {
    const botUrl = process.env.AI_ENGINE_URL || 'http://127.0.0.1:3001';
    const botApiKey =
      process.env.AI_ENGINE_API_KEY ||
      process.env.WEB_CHAT_API_KEY ||
      'enlight_ai_engine_secret_2026_auth_key';
    try {
      await axios.post(
        `${botUrl}/chat/web/permissions/invalidate`,
        {},
        {
          headers: {
            'X-Web-API-Key': botApiKey,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        },
      );
    } catch (err: any) {
      this.logger.warn(
        `Bot permission cache invalidate failed: ${err?.message || err}`,
      );
    }
  }

  catalog() {
    return { keys: PERMISSION_KEYS };
  }

  async list() {
    const { data, error } = await this.supabase
      .from('roles')
      .select('*')
      .order('is_system', { ascending: false });
    if (error || !data?.length) return this.builtinList();
    return data.map(this.toItem);
  }

  async create(
    body: {
      name: string;
      description?: string;
      data_scope?: string;
      permissions: Record<string, boolean>;
      visibility_scope?: Record<string, string[]>;
    },
    actor?: any,
  ) {
    const name = String(body?.name || '').trim();
    if (!name) throw new BadRequestException('Role name is required');
    await this.assertUniqueName(name);
    this.assertPerms(body.permissions);
    const scope = this.assertScope(body.data_scope || 'own');
    const id = `role_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString().slice(-4)}`;
    const { data, error } = await this.supabase
      .from('roles')
      .insert({
        id,
        name,
        description: body.description || '',
        data_scope: scope,
        is_system: false,
        permissions: body.permissions,
        visibility_scope: cleanVisibilityScope(body.visibility_scope),
        is_active: true,
        updated_at: new Date().toISOString(),
        updated_by: actor?.id || null,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    invalidatePermissions();
    await this.log(actor, 'role_created', id, `Created role ${name}`);
    return this.toItem(data);
  }

  async update(
    id: string,
    body: {
      name?: string;
      description?: string;
      data_scope?: string;
      permissions?: Record<string, boolean>;
      visibility_scope?: Record<string, string[]>;
    },
    actor?: any,
  ) {
    const existing = await this.getRow(id);
    const normId = normalizeRoleId(id);
    if (
      existing.is_system ||
      SYSTEM_ROLES.some((r) => r.id === normId || r.id === id)
    ) {
      throw new ForbiddenException(
        'System roles and their default permissions are fixed and non-editable. To customize permissions, create a new role using this template.',
      );
    }
    if (body.permissions) this.assertPerms(body.permissions);
    const nextPerms = body.permissions || existing.permissions || {};
    if (id === 'admin' && nextPerms['staff.manage_acl'] !== true) {
      throw new ForbiddenException(
        'The Admin role must keep permission to manage roles.',
      );
    }
    if (
      existing.permissions?.['staff.manage_acl'] === true &&
      nextPerms['staff.manage_acl'] !== true
    ) {
      await this.assertNotLastAcl(id, actor);
    }
    if (
      actor?.id &&
      normalizeRoleId(actor.role) === id &&
      actor.permissions?.['staff.manage_acl'] === true &&
      nextPerms['staff.manage_acl'] !== true
    ) {
      throw new ForbiddenException('You cannot remove your own role access.');
    }
    const patch: any = {
      updated_at: new Date().toISOString(),
      updated_by: actor?.id || null,
    };
    if (body.name) {
      const nextName = body.name.trim();
      await this.assertUniqueName(nextName, id);
      patch.name = nextName;
    }
    if (body.description !== undefined) patch.description = body.description;
    if (body.data_scope) patch.data_scope = this.assertScope(body.data_scope);
    if (body.permissions) patch.permissions = body.permissions;
    if (body.visibility_scope) {
      patch.visibility_scope = cleanVisibilityScope(body.visibility_scope);
    }
    const { data, error } = await this.supabase
      .from('roles')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    // Drop per-person copies so everyone on this role picks up the saved matrix.
    await this.supabase
      .from('employees')
      .update({ permissions: null })
      .eq('role', id);
    invalidatePermissions();
    await this.invalidateBotPermissionCache();
    await this.log(actor, 'role_updated', id, `Updated role ${data.name}`, {
      permissions: body.permissions || null,
    });
    return this.toItem(data);
  }

  async remove(id: string, actor?: any) {
    const existing = await this.getRow(id);
    const normId = normalizeRoleId(id);
    if (
      existing.is_system ||
      SYSTEM_ROLES.some((r) => r.id === normId || r.id === id)
    ) {
      throw new ForbiddenException('System roles cannot be deleted.');
    }
    const assigned = await this.assignedCount(id);
    if (assigned > 0) {
      throw new ForbiddenException(
        `This role is still assigned to ${assigned} people.`,
      );
    }
    const { error } = await this.supabase
      .from('roles')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    invalidatePermissions();
    await this.log(
      actor,
      'role_deleted',
      id,
      `Deactivated role ${existing.name}`,
    );
    return { ok: true };
  }

  async assignedCount(id: string): Promise<number> {
    const roles = id === 'sales_manager' ? ['sales_manager', 'manager'] : [id];
    const { count, error } = await this.supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .in('role', roles)
      .eq('is_active', true);
    if (error) return 0;
    return count || 0;
  }

  private async assertNotLastAcl(roleId: string, actor?: any) {
    const { data } = await this.supabase
      .from('roles')
      .select('id, permissions, is_active')
      .eq('is_active', true);
    const holders = (data || []).filter(
      (row: any) =>
        row.id !== roleId && row.permissions?.['staff.manage_acl'] === true,
    );
    if (holders.length === 0 && actor?.permissions?.['staff.manage_acl']) {
      throw new ForbiddenException(
        'At least one role must be able to manage permissions.',
      );
    }
  }

  private async getRow(id: string) {
    const { data, error } = await this.supabase
      .from('roles')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data || data.is_active === false)
      throw new NotFoundException('Role not found');
    return data;
  }

  private async assertUniqueName(name: string, exceptId?: string) {
    const { data, error } = await this.supabase
      .from('roles')
      .select('id, name')
      .eq('is_active', true);
    if (error) throw new BadRequestException(error.message);
    const wanted = name.trim().toLowerCase();
    const taken = (data || []).some(
      (row: { id: string; name?: string }) =>
        row.id !== exceptId &&
        String(row.name || '')
          .trim()
          .toLowerCase() === wanted,
    );
    if (taken) {
      throw new ConflictException(
        `A role named "${name.trim()}" already exists.`,
      );
    }
  }

  private assertPerms(perms: Record<string, boolean>) {
    if (!perms || typeof perms !== 'object') {
      throw new BadRequestException('permissions object is required');
    }
    const unknown = assertKnownPermissions(perms);
    if (unknown.length) {
      throw new BadRequestException(
        `Unknown permission keys: ${unknown.join(', ')}`,
      );
    }
  }

  private assertScope(scope: string): 'own' | 'team' | 'all' {
    if (scope === 'own' || scope === 'team' || scope === 'all') return scope;
    throw new BadRequestException('data_scope must be own, team, or all');
  }

  private builtinList() {
    return SYSTEM_ROLES.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      data_scope: ROLE_DATA_SCOPE[role.id],
      is_system: true,
      is_active: true,
      permissions: BUILTIN_ROLE_TEMPLATES[role.id],
      visibility_scope: {},
    }));
  }

  private toItem = (row: any) => {
    const roleId = normalizeRoleId(row.id);
    const isSys =
      Boolean(row.is_system) ||
      SYSTEM_ROLES.some((r) => r.id === row.id || r.id === roleId);
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      data_scope:
        isSys && ROLE_DATA_SCOPE[roleId]
          ? ROLE_DATA_SCOPE[roleId]
          : row.data_scope || 'own',
      is_system: isSys,
      is_active: row.is_active !== false,
      permissions:
        isSys && BUILTIN_ROLE_TEMPLATES[roleId]
          ? BUILTIN_ROLE_TEMPLATES[roleId]
          : row.permissions || {},
      visibility_scope: cleanVisibilityScope(row.visibility_scope),
    };
  };

  private async log(
    actor: any,
    action: string,
    entityId: string,
    description: string,
    change_detail?: any,
  ) {
    try {
      await this.supabase.from('activity_logs').insert({
        timestamp: new Date().toISOString(),
        salesperson_name: actor?.name || 'Admin',
        salesperson_phone: actor?.phone
          ? String(actor.phone).replace(/\D/g, '')
          : null,
        actor_phone: actor?.phone
          ? String(actor.phone).replace(/\D/g, '')
          : null,
        actor_name: actor?.name || 'Admin',
        description,
        module: 'Roles',
        source: 'dashboard',
        action_type: action,
        entity_id: entityId,
        entity_type: 'role',
        change_detail: change_detail || {},
      });
    } catch {
      /* non-blocking */
    }
  }
}

import {
  Injectable,
  Logger,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  isProcurementManager,
  isProcurementRole,
} from '../../common/utils/roles';
import { procurementScopeMode } from '../inquiries/procurement-permissions';
import {
  legacyDataScope,
  normalizeRoleId,
} from '../../common/acl/permissionKeys';
import {
  PermissionsService,
  invalidatePermissions,
} from '../roles/permissions.service';

export function normalizePhone(phone?: string): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '').slice(-10);
}

export function phoneMatches(phone1?: string, phone2?: string): boolean {
  if (!phone1 || !phone2) return false;
  const p1 = normalizePhone(phone1);
  const p2 = normalizePhone(phone2);
  return p1.length === 10 && p1 === p2;
}

export function phoneInList(phone?: string, list?: string[] | null): boolean {
  if (!phone || !list || list.length === 0) return false;
  const target = normalizePhone(phone);
  return list.some((p) => normalizePhone(p) === target);
}

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  private permissionsService?: PermissionsService;
  private activityLogs?: ActivityLogsService;

  constructor(
    private supabaseService: SupabaseService,
    @Optional() permissionsOrLogs?: PermissionsService | ActivityLogsService,
    @Optional() activityLogs?: ActivityLogsService,
  ) {
    if (
      permissionsOrLogs &&
      typeof (permissionsOrLogs as any).logActivity === 'function'
    ) {
      this.activityLogs = permissionsOrLogs as ActivityLogsService;
      this.permissionsService = undefined;
    } else {
      this.permissionsService = permissionsOrLogs as PermissionsService;
      this.activityLogs = activityLogs;
    }
  }

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  async findAll(
    currentEmployee?: any,
    requestedPhoneOverride?: string,
    mode?: string,
  ) {
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .select('*')
        .order('employee_id', { ascending: true });
      if (error) throw error;

      const allEmployees = data || [];

      // Admin callers always receive the complete employee directory across all roles
      if (!currentEmployee || currentEmployee.role === 'admin') {
        return allEmployees;
      }

      const isPersonalMode =
        mode === 'personal' || mode === 'strict_self' || mode === 'self';

      const effectiveEmp = currentEmployee;

      if (isPersonalMode && effectiveEmp) {
        const selfPhone = normalizePhone(effectiveEmp.phone);
        return allEmployees.filter(
          (emp: any) =>
            emp.id === effectiveEmp.id ||
            normalizePhone(emp.phone) === selfPhone,
        );
      }

      // If Sales Manager: return self + salespersons assigned under this manager
      if (
        effectiveEmp.role === 'sales_manager' ||
        effectiveEmp.role === 'manager'
      ) {
        const myId = effectiveEmp.id;
        const myPhone = normalizePhone(effectiveEmp.phone);

        return allEmployees.filter((emp: any) => {
          if (emp.id === myId || normalizePhone(emp.phone) === myPhone) {
            return true;
          }
          if (emp.manager_id && emp.manager_id === myId) {
            return true;
          }
          if (
            emp.manager_phone &&
            normalizePhone(emp.manager_phone) === myPhone
          ) {
            return true;
          }
          return false;
        });
      }

      // Procurement manager: self plus the people who report to them (assignee dropdown).
      // Checked before the salesperson fallback. Not a sales manager.
      if (isProcurementManager(effectiveEmp.role)) {
        const myId = effectiveEmp.id;
        const myPhone = normalizePhone(effectiveEmp.phone);
        return allEmployees.filter((emp: any) => {
          if (emp.id === myId || normalizePhone(emp.phone) === myPhone) {
            return true;
          }
          if (emp.manager_id && emp.manager_id === myId) return true;
          if (
            emp.manager_phone &&
            normalizePhone(emp.manager_phone) === myPhone
          ) {
            return true;
          }
          return false;
        });
      }

      // If Salesperson: return only self
      const selfPhone = normalizePhone(effectiveEmp.phone);
      return allEmployees.filter(
        (emp: any) =>
          emp.id === effectiveEmp.id || normalizePhone(emp.phone) === selfPhone,
      );
    } catch (error) {
      this.logger.error('Error fetching employees:', error);
      return [];
    }
  }

  async findByPhone(phone: string) {
    try {
      const clean = phone.replace(/\D/g, '');
      const last10 = clean.slice(-10);
      const variants = Array.from(
        new Set([phone, clean, last10, `91${last10}`, `+91${last10}`]),
      );

      const { data, error } = await this.supabase
        .from('employees')
        .select('*')
        .in('phone', variants)
        .eq('is_active', true)
        .limit(1);

      if (error || !data || data.length === 0) return null;
      return data[0];
    } catch (error) {
      this.logger.error(`Error in findByPhone for phone ${phone}:`, error);
      return null;
    }
  }

  async findById(id: string) {
    try {
      if (!id) return null;
      const { data, error } = await this.supabase
        .from('employees')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error || !data) return null;
      return data;
    } catch (error) {
      this.logger.error(`Error in findById for id ${id}:`, error);
      return null;
    }
  }

  async findByEmployeeId(employeeId: string) {
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .select('*')
        .eq('employee_id', employeeId)
        .single();
      if (error) return null;
      return data;
    } catch (error) {
      this.logger.error(
        `Error in findByEmployeeId for id ${employeeId}:`,
        error,
      );
      return null;
    }
  }

  // Get assigned salespersons for a Sales Manager
  async getAssignedSalespersons(
    managerId?: string,
    managerPhone?: string,
  ): Promise<any[]> {
    try {
      if (!managerId && !managerPhone) return [];

      const { data, error } = await this.supabase
        .from('employees')
        .select('*')
        .eq('is_active', true);

      if (error || !data) return [];

      const normPhone = normalizePhone(managerPhone);
      return data.filter((emp: any) => {
        // Before any manager-substring logic: procurement staff are not a sales team.
        if (isProcurementRole(emp.role)) return false;
        if (
          emp.role === 'admin' ||
          emp.role === 'sales_manager' ||
          emp.role === 'manager'
        )
          return false;
        if (
          managerId &&
          (emp.manager_id === managerId ||
            emp.reports_to_employee_id === managerId)
        )
          return true;
        if (normPhone && normalizePhone(emp.manager_phone) === normPhone)
          return true;
        return false;
      });
    } catch (error) {
      this.logger.error('Error in getAssignedSalespersons:', error);
      return [];
    }
  }

  /**
   * Determine the authorized list of salesperson phones for any given API request:
   * - Admin: If requested override belongs to a Sales Manager -> returns their full team phones.
   *          If requested override belongs to a Salesperson -> returns [override phone].
   *          If no override -> returns null (unrestricted/all).
   * - Sales Manager: Returns requested phone (if in assigned team) or array of all team phones
   * - Salesperson: Strictly returns [employee.phone]
   */
  async getAccessibleSalespersonPhones(
    employee: any,
    requestedPhoneOverride?: string,
    mode?: string,
    scopeAssignedKey?: string,
  ): Promise<{
    phones: string[] | null;
    isManagerView?: boolean;
    isPersonalView?: boolean;
  }> {
    const isPersonalMode =
      mode === 'personal' || mode === 'strict_self' || mode === 'self';

    if (
      scopeAssignedKey &&
      employee &&
      !employee.isInternal &&
      employee.permissions?.[scopeAssignedKey] === true
    ) {
      return { phones: employee.phone ? [employee.phone] : [] };
    }

    const scope =
      !employee || employee.isInternal
        ? 'all'
        : employee.dataScope || legacyDataScope(employee.role);

    if (
      scope === 'all' ||
      employee?.role === 'admin' ||
      employee?.role === 'super_admin'
    ) {
      if (requestedPhoneOverride) {
        const normOverride = normalizePhone(requestedPhoneOverride);
        const { data: allEmps } = await this.supabase
          .from('employees')
          .select('*')
          .eq('is_active', true);

        const targetEmp = (allEmps || []).find(
          (e: any) => normalizePhone(e.phone) === normOverride,
        );

        const targetScope = await this.scopeFor(targetEmp);
        if (targetEmp && targetScope === 'team') {
          if (isPersonalMode) {
            return { phones: [targetEmp.phone], isPersonalView: true };
          }

          const assigned = await this.getAssignedSalespersons(
            targetEmp.id,
            targetEmp.phone,
          );
          const teamPhones = Array.from(
            new Set(assigned.map((a: any) => a.phone).filter(Boolean)),
          );
          if (targetEmp.phone && !teamPhones.includes(targetEmp.phone)) {
            teamPhones.push(targetEmp.phone);
          }
          return { phones: teamPhones, isManagerView: true };
        }

        return {
          phones: [requestedPhoneOverride],
          isPersonalView: isPersonalMode,
        };
      }

      if (isPersonalMode && employee?.phone) {
        return { phones: [employee.phone], isPersonalView: true };
      }

      return { phones: null };
    }

    if (scope === 'team') {
      const assigned = await this.getAssignedSalespersons(
        employee.id,
        employee.phone,
      );
      const teamPhones = Array.from(
        new Set(assigned.map((a: any) => a.phone).filter(Boolean)),
      );
      if (employee.phone && !teamPhones.includes(employee.phone)) {
        teamPhones.push(employee.phone);
      }

      if (isPersonalMode) {
        return { phones: [employee.phone], isPersonalView: true };
      }

      if (requestedPhoneOverride) {
        const normReq = normalizePhone(requestedPhoneOverride);
        if (normReq === normalizePhone(employee.phone)) {
          return { phones: [employee.phone], isPersonalView: true };
        }

        const isAllowed = phoneInList(requestedPhoneOverride, teamPhones);
        if (!isAllowed) {
          throw new ForbiddenException(
            'Access Denied: You do not have permission to view data for this salesperson.',
          );
        }
        return { phones: [requestedPhoneOverride] };
      }

      return { phones: teamPhones, isManagerView: true };
    }

    return { phones: employee?.phone ? [employee.phone] : [] };
  }

  private async scopeFor(targetEmp: any): Promise<'own' | 'team' | 'all'> {
    if (!targetEmp) return 'own';
    if (this.permissionsService && targetEmp.id) {
      try {
        const resolved = await this.permissionsService.resolve(targetEmp.id);
        if (resolved?.dataScope) return resolved.dataScope;
      } catch {
        /* use the role string */
      }
    }
    return legacyDataScope(targetEmp.role);
  }

  /**
   * employees.id values this caller may open.
   * Admin: null, unrestricted. Salesperson: their own id.
   * Sales manager: their own id plus the salespeople assigned to them.
   */
  async getAccessibleSalespersonIds(employee: any): Promise<string[] | null> {
    if (
      !employee ||
      employee.role === 'admin' ||
      employee.role === 'super_admin'
    ) {
      return null;
    }
    if (employee.role === 'sales_manager' || employee.role === 'manager') {
      const assigned = await this.getAssignedSalespersons(
        employee.id,
        employee.phone,
      );
      const ids = assigned.map((person: any) => person.id).filter(Boolean);
      if (employee.id) ids.push(employee.id);
      return Array.from(new Set(ids));
    }
    return employee.id ? [employee.id] : [];
  }

  /**
   * Inquiry ids a procurement user may see.
   * Person: inquiries stamped to them.
   * Manager: inquiries stamped to them and to the procurement people who
   * report to them. An inquiry with no procurement owner stays out of both lists.
   */
  async getAccessibleProcurementIds(
    employee: any,
    permissions?: Record<string, boolean>,
  ): Promise<{
    ids: string[];
    includeUnassignedPool: boolean;
    salespersonPhones?: string[];
    salespersonEmployeeIds?: string[];
    stampedOnly?: boolean;
  }> {
    const ownId = employee?.id ? [employee.id] : [];
    const mode = permissions
      ? procurementScopeMode(permissions)
      : !employee || !isProcurementManager(employee.role)
        ? 'assigned'
        : 'team';
    if (mode === 'stamped') {
      return {
        ids: ownId,
        includeUnassignedPool: false,
        salespersonPhones: [],
        salespersonEmployeeIds: [],
        stampedOnly: true,
      };
    }
    if (mode === 'assigned') {
      const routed = await this.salespeopleRoutedTo(ownId);
      return {
        ids: ownId,
        includeUnassignedPool: false,
        salespersonPhones: routed.phones,
        salespersonEmployeeIds: routed.ids,
      };
    }

    const { data } = await this.supabase
      .from('employees')
      .select('id, role, manager_id, manager_phone')
      .eq('is_active', true);

    const myPhone = normalizePhone(employee.phone);
    const teamIds = (data || [])
      .filter((emp: any) => {
        if (!emp?.id || emp.id === employee.id) return false;
        const role = String(emp.role || '').toLowerCase();
        if (
          role === 'admin' ||
          role === 'sales_manager' ||
          role === 'manager' ||
          isProcurementManager(role)
        ) {
          return false;
        }
        if (emp.manager_id && emp.manager_id === employee.id) return true;
        if (myPhone && normalizePhone(emp.manager_phone) === myPhone) {
          return true;
        }
        return false;
      })
      .map((emp: any) => emp.id);

    const routed = await this.salespeopleRoutedTo(teamIds);
    return {
      ids: Array.from(new Set([...ownId, ...teamIds])),
      includeUnassignedPool: false,
      salespersonPhones: routed.phones,
      salespersonEmployeeIds: routed.ids,
    };
  }

  private assertManagerFitsRole(role: string, mgr: any) {
    const mgrRole = String(mgr?.role || '').toLowerCase();
    if (
      role === 'salesperson' &&
      mgrRole !== 'sales_manager' &&
      mgrRole !== 'manager'
    ) {
      throw new BadRequestException(
        'A salesperson must be assigned to a sales manager.',
      );
    }
    if (role === 'procurement_person' && !isProcurementManager(mgrRole)) {
      throw new BadRequestException(
        'A procurement person must be assigned to a procurement manager.',
      );
    }
  }

  async create(dto: {
    employee_id: string;
    name: string;
    phone: string;
    email?: string;
    role?: string;
    manager_id?: string | null;
    manager_phone?: string | null;
    permissions?: Record<string, boolean> | null;
    assigned_salesperson_ids?: string[];
  }) {
    try {
      // Check duplicate phone
      const existing = await this.findByPhone(dto.phone);
      if (existing) {
        throw new ConflictException(
          `Phone number ${dto.phone} is already registered to ${existing.name} (${existing.employee_id}). Please unassign or change their phone number first.`,
        );
      }

      // Check duplicate employee_id
      const existingId = await this.findByEmployeeId(dto.employee_id);
      if (existingId) {
        throw new ConflictException(
          `Employee ID ${dto.employee_id} already exists`,
        );
      }

      const role = dto.role || 'salesperson';
      const insertPayload: any = {
        employee_id: dto.employee_id,
        name: dto.name,
        phone: dto.phone,
        email: dto.email || null,
        role,
        is_active: true,
        created_at: new Date().toISOString(),
      };

      if (dto.permissions) {
        insertPayload.permissions = dto.permissions;
      }

      if (
        (role === 'salesperson' || role === 'procurement_person') &&
        (dto.manager_id || dto.manager_phone)
      ) {
        let mgr: any = null;
        if (dto.manager_id) {
          const { data } = await this.supabase
            .from('employees')
            .select('*')
            .eq('id', dto.manager_id)
            .single();
          mgr = data;
        } else if (dto.manager_phone) {
          mgr = await this.findByPhone(dto.manager_phone);
        }

        if (mgr) {
          this.assertManagerFitsRole(role, mgr);
          insertPayload.manager_id = mgr.id;
          insertPayload.manager_phone = mgr.phone;
          insertPayload.reports_to_employee_id = mgr.id;
        }
      }

      const { data, error } = await this.supabase
        .from('employees')
        .insert(insertPayload)
        .select()
        .single();

      if (error) throw error;
      this.logger.log(`Employee created: ${dto.employee_id} - ${dto.name}`);
      if (
        data?.id &&
        role === 'procurement_person' &&
        Array.isArray(dto.assigned_salesperson_ids)
      ) {
        await this.syncProcurementSalespeople(
          data.id,
          dto.assigned_salesperson_ids,
        );
      }
      return data;
    } catch (error) {
      this.logger.error('Error in create employee:', error);
      throw error;
    }
  }

  async update(
    id: string,
    dto: Partial<{
      name: string;
      phone: string;
      email: string;
      role: string;
      is_active: boolean;
      manager_id: string | null;
      manager_phone: string | null;
      reports_to_employee_id: string | null;
      permissions?: Record<string, boolean> | null;
      assigned_salesperson_ids?: string[];
    }>,
    caller?: { phone?: string; name?: string },
  ) {
    try {
      // 1. Fetch current employee state to detect phone changes
      const { data: currentEmp, error: fetchErr } = await this.supabase
        .from('employees')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchErr || !currentEmp) {
        throw new NotFoundException('Employee not found');
      }

      const oldPhone = currentEmp.phone;
      const wasActive = currentEmp.is_active;

      // 2. Validate duplicate phone conflict
      if (dto.phone) {
        const existing = await this.findByPhone(dto.phone);
        if (existing && existing.id !== id) {
          throw new ConflictException(
            `Phone number ${dto.phone} is already registered to ${existing.name} (${existing.employee_id}). Please unassign or change their phone number first.`,
          );
        }
      }

      const assignedSalespersonIds = dto.assigned_salesperson_ids;
      const updatePayload: any = { ...dto };
      delete updatePayload.assigned_salesperson_ids;

      const nextRole = dto.role || currentEmp.role;
      // Only when the saved role is one of these. A partial update such as
      // { is_active: true } must not clear an existing manager link.
      if (
        dto.role === 'sales_manager' ||
        dto.role === 'admin' ||
        dto.role === 'manager' ||
        isProcurementManager(dto.role)
      ) {
        updatePayload.manager_id = null;
        updatePayload.manager_phone = null;
        updatePayload.reports_to_employee_id = null;
      } else if (dto.manager_id || dto.manager_phone) {
        let mgr: any = null;
        if (dto.manager_id) {
          const { data } = await this.supabase
            .from('employees')
            .select('*')
            .eq('id', dto.manager_id)
            .single();
          mgr = data;
        } else if (dto.manager_phone) {
          mgr = await this.findByPhone(dto.manager_phone);
        }

        if (mgr) {
          if (mgr.id === id) {
            throw new BadRequestException(
              'An employee cannot be assigned as their own manager.',
            );
          }
          this.assertManagerFitsRole(nextRole, mgr);
          updatePayload.manager_id = mgr.id;
          updatePayload.manager_phone = mgr.phone;
          updatePayload.reports_to_employee_id = mgr.id;
        }
      } else if (dto.manager_id === null || dto.manager_id === '') {
        updatePayload.manager_id = null;
        updatePayload.manager_phone = null;
        updatePayload.reports_to_employee_id = null;
      }

      const previousRole = currentEmp.role;

      // 3. Update employee record
      const { data, error } = await this.supabase
        .from('employees')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      invalidatePermissions(id);
      if (
        dto.role &&
        normalizeRoleId(dto.role) !== normalizeRoleId(currentEmp.role)
      ) {
        await this.supabase.from('activity_logs').insert({
          timestamp: new Date().toISOString(),
          salesperson_name: currentEmp.name,
          description: `Role changed from ${currentEmp.role} to ${dto.role}`,
          module: 'Roles',
          source: 'dashboard',
          action_type: 'employee_role_changed',
          entity_id: id,
          entity_type: 'employee',
          change_detail: { from: currentEmp.role, to: dto.role },
        });
      }

      if (typeof dto.is_active === 'boolean' && dto.is_active !== wasActive) {
        this.logLifecycle(
          dto.is_active ? 'employee_activated' : 'employee_deactivated',
          currentEmp,
          caller,
        );
      }

      if (dto.role && this.roleKey(dto.role) !== this.roleKey(previousRole)) {
        const fromRole = String(previousRole || '');
        const toRole = String(dto.role);
        const fromName = await this.roleLabel(fromRole);
        const toName = await this.roleLabel(toRole);
        this.activityLogs?.logActivity({
          module: 'Roles',
          action_type: 'employee_role_changed',
          entity_type: 'employee',
          entity_id: currentEmp.id,
          salesperson_name: currentEmp.name,
          description: `Role changed from ${fromName} to ${toName}`,
          change_detail: {
            from_role: fromRole,
            to_role: toRole,
            from_name: fromName,
            to_name: toName,
          },
        });
      }

      if (Array.isArray(assignedSalespersonIds)) {
        await this.syncProcurementSalespeople(
          id,
          nextRole === 'procurement_person' ? assignedSalespersonIds : [],
        );
      }

      // 4. If phone changed, cascade to all related transactional records
      if (dto.phone) {
        const cleanOld = normalizePhone(oldPhone);
        const cleanNew = normalizePhone(dto.phone);
        if (cleanNew && cleanNew !== cleanOld) {
          await this.cascadePhoneUpdate(
            id,
            oldPhone,
            dto.phone,
            currentEmp.name,
          );
        }
      }

      return data;
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      if ((error as any)?.code === '23505') {
        const detail = String(
          (error as any)?.details || (error as any)?.message || '',
        );
        if (detail.includes('phone')) {
          throw new ConflictException(
            `This phone number is already registered to another employee. Please change or unassign their phone number first.`,
          );
        }
      }
      this.logger.error(`Error in update for employee ${id}:`, error);
      throw error;
    }
  }

  /**
   * One salesperson routes to one procurement person. Saving the control-panel
   * selection writes that person onto each salesperson and moves their open,
   * still-unassigned inquiries into that person's queue.
   */
  private async syncProcurementSalespeople(
    personId: string,
    salespersonIds: string[],
  ) {
    const uniqueIds = Array.from(new Set(salespersonIds.filter(Boolean)));
    let selected: any[] = [];
    if (uniqueIds.length) {
      const { data, error } = await this.supabase
        .from('employees')
        .select('id, role, is_active, phone')
        .in('id', uniqueIds);
      if (error) throw error;
      selected = data || [];
      const valid =
        selected.length === uniqueIds.length &&
        selected.every(
          (emp) => emp.role === 'salesperson' && emp.is_active !== false,
        );
      if (!valid) {
        throw new BadRequestException(
          'Each assigned salesperson must be an active salesperson.',
        );
      }
    }

    const { data: current, error: currentErr } = await this.supabase
      .from('employees')
      .select('id')
      .eq('assigned_procurement_employee_id', personId);
    if (currentErr) throw currentErr;
    const removeIds = (current || [])
      .map((emp: any) => emp.id)
      .filter((empId: string) => !uniqueIds.includes(empId));
    if (removeIds.length) {
      const { error } = await this.supabase
        .from('employees')
        .update({ assigned_procurement_employee_id: null })
        .in('id', removeIds);
      if (error) throw error;
    }
    if (uniqueIds.length) {
      const { error } = await this.supabase
        .from('employees')
        .update({ assigned_procurement_employee_id: personId })
        .in('id', uniqueIds);
      if (error) throw error;
    }

    const assignedAt = new Date().toISOString();
    const phones = new Set(
      selected
        .map((salesperson) => normalizePhone(salesperson.phone))
        .filter((phone) => phone.length === 10),
    );
    const employeeIds = new Set(selected.map((salesperson) => salesperson.id));
    const [{ data: openRows, error: listErr }, { data: customers }] =
      await Promise.all([
        this.supabase
          .from('inquiries')
          .select(
            'id, salesperson_phone, sender_phone, employee_id, customer_name, ai_extraction_json, procurement_employee_id',
          )
          .is('procurement_employee_id', null),
        this.supabase
          .from('recurring_customers')
          .select('customer_name, assigned_salesperson_phone'),
      ]);
    if (listErr) throw listErr;
    const customerNames = new Set<string>();
    for (const customer of customers || []) {
      const phone = normalizePhone(customer.assigned_salesperson_phone);
      const name = String(customer.customer_name || '')
        .trim()
        .toLowerCase();
      if (phone.length === 10 && phones.has(phone) && name) {
        customerNames.add(name);
      }
    }
    const matchIds = (openRows || [])
      .filter((row: any) => {
        if (row.employee_id && employeeIds.has(row.employee_id)) return true;
        const stored = normalizePhone(row.salesperson_phone);
        if (stored.length === 10 && phones.has(stored)) return true;
        const sender = normalizePhone(row.sender_phone);
        if (sender.length === 10 && phones.has(sender)) return true;
        const ai = row.ai_extraction_json || {};
        const name = String(row.customer_name || ai.customer_name || '')
          .trim()
          .toLowerCase();
        return Boolean(name && customerNames.has(name));
      })
      .map((row: any) => row.id);
    if (matchIds.length) {
      const { error } = await this.supabase
        .from('inquiries')
        .update({
          procurement_employee_id: personId,
          procurement_assigned_at: assignedAt,
        })
        .in('id', matchIds);
      if (error) throw error;
    }
  }

  private async salespeopleRoutedTo(personIds: string[]) {
    if (!personIds.length)
      return { phones: [] as string[], ids: [] as string[] };
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .select('id, phone, role, is_active, assigned_procurement_employee_id')
        .in('assigned_procurement_employee_id', personIds);
      if (error) return { phones: [], ids: [] };
      const assigned = (data || []).filter(
        (emp: any) => emp.role === 'salesperson' && emp.is_active !== false,
      );
      return {
        phones: assigned
          .map((emp: any) => normalizePhone(emp.phone))
          .filter((phone: string) => phone.length === 10),
        ids: assigned.map((emp: any) => emp.id),
      };
    } catch {
      return { phones: [], ids: [] };
    }
  }

  /**
   * Automatically cascades a phone number change across all related business tables:
   * deals, inquiries, customer_visits, kra_logs, recurring_customers,
   * followup_tasks, payment_tracking, complaints, conversation_sessions,
   * activity_logs, subordinate employees (manager_phone), and otp_sessions.
   */
  private async cascadePhoneUpdate(
    employeeId: string,
    oldPhone: string,
    newPhone: string,
    empName?: string,
  ): Promise<void> {
    try {
      const cleanOld10 = normalizePhone(oldPhone);
      const cleanNew10 = normalizePhone(newPhone);

      if (!cleanOld10 || !cleanNew10 || cleanOld10 === cleanNew10) {
        return;
      }

      const canonicalNew = `91${cleanNew10}`;
      const oldVariants = Array.from(
        new Set(
          [
            cleanOld10,
            `91${cleanOld10}`,
            `+91${cleanOld10}`,
            oldPhone,
            String(oldPhone || '').replace(/\D/g, ''),
          ].filter(Boolean),
        ),
      );

      this.logger.log(
        `[CascadePhoneUpdate] Initiating cascade for employee ${employeeId} (${empName || ''}) from [${oldVariants.join(', ')}] to ${canonicalNew}`,
      );

      // 1. Deals: update salesperson_phone and stamp employee_id
      await this.supabase
        .from('deals')
        .update({ salesperson_phone: canonicalNew, employee_id: employeeId })
        .in('salesperson_phone', oldVariants);

      await this.supabase
        .from('deals')
        .update({ salesperson_phone: canonicalNew, employee_id: employeeId })
        .eq('employee_id', employeeId);

      // 2. Inquiries: update salesperson_phone, sender_phone, and stamp employee_id
      await this.supabase
        .from('inquiries')
        .update({ salesperson_phone: canonicalNew, employee_id: employeeId })
        .in('salesperson_phone', oldVariants);

      await this.supabase
        .from('inquiries')
        .update({ salesperson_phone: canonicalNew, employee_id: employeeId })
        .eq('employee_id', employeeId);

      await this.supabase
        .from('inquiries')
        .update({ sender_phone: canonicalNew })
        .in('sender_phone', oldVariants);

      // 3. Customer Visits: update salesperson_phone and stamp employee_id
      await this.supabase
        .from('customer_visits')
        .update({ salesperson_phone: canonicalNew, employee_id: employeeId })
        .in('salesperson_phone', oldVariants);

      await this.supabase
        .from('customer_visits')
        .update({ salesperson_phone: canonicalNew, employee_id: employeeId })
        .eq('employee_id', employeeId);

      // 4. KRA Logs: update salesperson_phone and stamp employee_id
      await this.supabase
        .from('kra_logs')
        .update({ salesperson_phone: canonicalNew, employee_id: employeeId })
        .in('salesperson_phone', oldVariants);

      await this.supabase
        .from('kra_logs')
        .update({ salesperson_phone: canonicalNew, employee_id: employeeId })
        .eq('employee_id', employeeId);

      // 5. Recurring Customers: update assigned_salesperson_phone
      await this.supabase
        .from('recurring_customers')
        .update({ assigned_salesperson_phone: canonicalNew })
        .in('assigned_salesperson_phone', oldVariants);

      // 6. Followup Tasks: update salesperson_phone and stamp employee_id
      await this.supabase
        .from('followup_tasks')
        .update({ salesperson_phone: canonicalNew, employee_id: employeeId })
        .in('salesperson_phone', oldVariants);

      await this.supabase
        .from('followup_tasks')
        .update({ salesperson_phone: canonicalNew, employee_id: employeeId })
        .eq('employee_id', employeeId);

      // 7. Payment Tracking: update salesperson_phone and stamp employee_id
      await this.supabase
        .from('payment_tracking')
        .update({ salesperson_phone: canonicalNew, employee_id: employeeId })
        .in('salesperson_phone', oldVariants);

      await this.supabase
        .from('payment_tracking')
        .update({ salesperson_phone: canonicalNew, employee_id: employeeId })
        .eq('employee_id', employeeId);

      // 8. Complaints: update reported_by and stamp employee_id
      await this.supabase
        .from('complaints')
        .update({ reported_by: canonicalNew, employee_id: employeeId })
        .in('reported_by', oldVariants);

      await this.supabase
        .from('complaints')
        .update({ reported_by: canonicalNew, employee_id: employeeId })
        .eq('employee_id', employeeId);

      // 9. Conversation Sessions (WhatsApp Bot rolling buffer)
      await this.supabase
        .from('conversation_sessions')
        .update({ salesperson_phone: canonicalNew })
        .in('salesperson_phone', oldVariants);

      // 10. Activity Logs: update salesperson_phone and actor_phone
      await this.supabase
        .from('activity_logs')
        .update({ salesperson_phone: canonicalNew })
        .in('salesperson_phone', oldVariants);

      await this.supabase
        .from('activity_logs')
        .update({ actor_phone: canonicalNew })
        .in('actor_phone', oldVariants);

      // 11. Subordinates: update manager_phone if this employee is a manager
      await this.supabase
        .from('employees')
        .update({ manager_phone: canonicalNew })
        .eq('manager_id', employeeId);

      await this.supabase
        .from('employees')
        .update({ manager_phone: canonicalNew })
        .in('manager_phone', oldVariants);

      // 12. Invalidate obsolete unverified OTP sessions for old phone
      await this.supabase
        .from('otp_sessions')
        .delete()
        .in('phone', oldVariants)
        .eq('verified', false);

      this.logger.log(
        `[CascadePhoneUpdate] Successfully completed cascade for employee ${employeeId} (${empName || ''}) to ${canonicalNew}`,
      );
    } catch (err: any) {
      this.logger.error(
        `[CascadePhoneUpdate] Error during phone cascade for employee ${employeeId}: ${err?.message || err}`,
        err?.stack,
      );
    }
  }

  async deactivate(id: string, caller?: { phone?: string; name?: string }) {
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .update({ is_active: false })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      this.logLifecycle('employee_deactivated', data, caller);
      return data;
    } catch (error) {
      this.logger.error(`Error in deactivate for employee ${id}:`, error);
      throw error;
    }
  }

  async delete(id: string, caller?: any) {
    try {
      if (caller?.id === id) {
        throw new BadRequestException('You cannot delete your own account.');
      }

      // 1. Fetch target employee
      const { data: targetEmp, error: fetchErr } = await this.supabase
        .from('employees')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchErr || !targetEmp) {
        throw new NotFoundException('Employee not found');
      }

      const phone = targetEmp.phone;
      const empName = targetEmp.name;

      // 2. Fetch associated deals to clean up deal_items, payment_tracking & followup_tasks
      let dealIds: string[] = [];
      const dealOrConditions: string[] = [`employee_id.eq.${id}`];
      if (phone) {
        dealOrConditions.push(`salesperson_phone.eq.${phone}`);
      }
      const { data: dealsData } = await this.supabase
        .from('deals')
        .select('id')
        .or(dealOrConditions.join(','));

      if (dealsData && dealsData.length > 0) {
        dealIds = dealsData.map((d: any) => d.id).filter(Boolean);
      }

      if (dealIds.length > 0) {
        await this.supabase.from('deal_items').delete().in('deal_id', dealIds);
        await this.supabase
          .from('payment_tracking')
          .delete()
          .in('deal_id', dealIds);
        await this.supabase
          .from('followup_tasks')
          .delete()
          .in('deal_id', dealIds);
        await this.supabase.from('deals').delete().in('id', dealIds);
      }

      // 3. Delete inquiries
      const inqOr: string[] = [`employee_id.eq.${id}`];
      if (phone) inqOr.push(`salesperson_phone.eq.${phone}`);
      await this.supabase.from('inquiries').delete().or(inqOr.join(','));

      // 4. Delete customer_visits
      const visitOr: string[] = [`employee_id.eq.${id}`];
      if (phone) visitOr.push(`salesperson_phone.eq.${phone}`);
      await this.supabase
        .from('customer_visits')
        .delete()
        .or(visitOr.join(','));

      // 5. Delete kra_logs
      const kraOr: string[] = [`employee_id.eq.${id}`];
      if (phone) kraOr.push(`salesperson_phone.eq.${phone}`);
      await this.supabase.from('kra_logs').delete().or(kraOr.join(','));

      // 6. Delete complaints
      const compOr: string[] = [`employee_id.eq.${id}`];
      if (empName) compOr.push(`reported_by.ilike.%${empName}%`);
      await this.supabase.from('complaints').delete().or(compOr.join(','));

      // 7. Unassign customers assigned to this salesperson
      if (phone) {
        await this.supabase
          .from('recurring_customers')
          .update({ assigned_salesperson_phone: 'unassigned' })
          .eq('assigned_salesperson_phone', phone);
      }

      // 8. Unlink any subordinates reporting to this employee as manager
      await this.supabase
        .from('employees')
        .update({
          manager_id: null,
          manager_phone: null,
          reports_to_employee_id: null,
        })
        .eq('manager_id', id);

      // 9. Finally delete the employee record
      const { error: deleteErr } = await this.supabase
        .from('employees')
        .delete()
        .eq('id', id);

      if (deleteErr) throw deleteErr;

      this.logger.log(
        `Employee ${targetEmp.employee_id} (${empName}) and all associated records deleted successfully.`,
      );
      this.logLifecycle('employee_deleted', targetEmp, caller);
      return {
        success: true,
        message: `Employee ${empName} (${targetEmp.employee_id}) and all associated records deleted successfully.`,
      };
    } catch (error) {
      this.logger.error(`Error deleting employee ${id}:`, error);
      throw error;
    }
  }

  private logLifecycle(
    action: 'employee_activated' | 'employee_deactivated' | 'employee_deleted',
    target: {
      id?: string;
      employee_id?: string;
      name?: string;
      role?: string;
    },
    caller?: { phone?: string; name?: string },
  ) {
    const verb =
      action === 'employee_activated'
        ? 'Activated'
        : action === 'employee_deactivated'
          ? 'Deactivated'
          : 'Deleted';
    const who = [
      target?.name,
      target?.employee_id ? `(${target.employee_id})` : '',
    ]
      .filter(Boolean)
      .join(' ');
    this.activityLogs?.logActivity({
      module: 'Employees',
      action_type: action,
      entity_type: 'employee',
      entity_id: target?.id,
      salesperson_phone: caller?.phone,
      salesperson_name: caller?.name,
      description: `${verb} ${who}`.trim(),
      change_detail: {
        target_id: target?.id || null,
        target_employee_id: target?.employee_id || null,
        target_name: target?.name || null,
        target_role: target?.role || null,
      },
    });
  }

  private roleKey(role: any): string {
    return String(role || '')
      .trim()
      .toLowerCase();
  }

  private async roleLabel(role: string): Promise<string> {
    const key = this.roleKey(role);
    if (!key) return '';
    try {
      const { data } = await this.supabase
        .from('roles')
        .select('name')
        .eq('key', key)
        .maybeSingle();
      if (data?.name) return data.name;
    } catch {
      // ignore
    }
    const builtins: Record<string, string> = {
      admin: 'Admin',
      sales_manager: 'Sales Manager',
      manager: 'Sales Manager',
      salesperson: 'Salesperson',
      finance: 'Finance / Accounts',
      operations: 'Operations / Logistics',
    };
    return builtins[key] || role;
  }

  // Generate next employee ID automatically
  async generateNextEmployeeId(): Promise<string> {
    try {
      const { data } = await this.supabase
        .from('employees')
        .select('employee_id');

      if (!data || data.length === 0) return 'EMP001';

      const nums = data
        .map((d: any) => {
          const match = d.employee_id?.match(/EMP(\d+)/i);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter((n: number) => !isNaN(n) && n > 0);

      const maxNum = nums.length > 0 ? Math.max(...nums) : 0;
      return `EMP${String(maxNum + 1).padStart(3, '0')}`;
    } catch (error) {
      this.logger.error('Error in generateNextEmployeeId:', error);
      return 'EMP001';
    }
  }
}

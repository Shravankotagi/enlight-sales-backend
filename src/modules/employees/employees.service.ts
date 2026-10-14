import {
  Injectable,
  Logger,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

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

  constructor(private supabaseService: SupabaseService) {}

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
  ): Promise<{
    phones: string[] | null;
    isManagerView?: boolean;
    isPersonalView?: boolean;
  }> {
    const isPersonalMode =
      mode === 'personal' || mode === 'strict_self' || mode === 'self';

    if (!employee || employee.role === 'admin') {
      if (requestedPhoneOverride) {
        const normOverride = normalizePhone(requestedPhoneOverride);
        const { data: allEmps } = await this.supabase
          .from('employees')
          .select('*')
          .eq('is_active', true);

        const targetEmp = (allEmps || []).find(
          (e: any) => normalizePhone(e.phone) === normOverride,
        );

        if (
          targetEmp &&
          (targetEmp.role === 'sales_manager' || targetEmp.role === 'manager')
        ) {
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

    if (employee.role === 'sales_manager' || employee.role === 'manager') {
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
        // If manager requested their own phone, treat as personal mode
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

    // Default Salesperson: strictly own phone
    return { phones: [employee.phone] };
  }

  async create(dto: {
    employee_id: string;
    name: string;
    phone: string;
    email?: string;
    role?: string;
    manager_id?: string | null;
    manager_phone?: string | null;
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

      if (role === 'salesperson' && (dto.manager_id || dto.manager_phone)) {
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
    }>,
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

      // 2. Validate duplicate phone conflict
      if (dto.phone) {
        const existing = await this.findByPhone(dto.phone);
        if (existing && existing.id !== id) {
          throw new ConflictException(
            `Phone number ${dto.phone} is already registered to ${existing.name} (${existing.employee_id}). Please unassign or change their phone number first.`,
          );
        }
      }

      const updatePayload: any = { ...dto };

      if (dto.role === 'sales_manager' || dto.role === 'admin') {
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
          updatePayload.manager_id = mgr.id;
          updatePayload.manager_phone = mgr.phone;
          updatePayload.reports_to_employee_id = mgr.id;
        }
      } else if (dto.manager_id === null || dto.manager_id === '') {
        updatePayload.manager_id = null;
        updatePayload.manager_phone = null;
        updatePayload.reports_to_employee_id = null;
      }

      // 3. Update employee record
      const { data, error } = await this.supabase
        .from('employees')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

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

  async deactivate(id: string) {
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .update({ is_active: false })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
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
      return {
        success: true,
        message: `Employee ${empName} (${targetEmp.employee_id}) and all associated records deleted successfully.`,
      };
    } catch (error) {
      this.logger.error(`Error deleting employee ${id}:`, error);
      throw error;
    }
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

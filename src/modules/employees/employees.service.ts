import {
  Injectable,
  Logger,
  ConflictException,
  ForbiddenException,
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

  async findAll(currentEmployee?: any) {
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .select('*')
        .order('employee_id', { ascending: true });
      if (error) throw error;

      const allEmployees = data || [];

      // If no current employee or admin, return all
      if (!currentEmployee || currentEmployee.role === 'admin') {
        return allEmployees;
      }

      // If Sales Manager: return self + salespersons assigned under this manager
      if (
        currentEmployee.role === 'sales_manager' ||
        currentEmployee.role === 'manager'
      ) {
        const myId = currentEmployee.id;
        const myPhone = normalizePhone(currentEmployee.phone);

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
      const selfPhone = normalizePhone(currentEmployee.phone);
      return allEmployees.filter(
        (emp: any) =>
          emp.id === currentEmployee.id ||
          normalizePhone(emp.phone) === selfPhone,
      );
    } catch (error) {
      this.logger.error('Error in findAll:', error);
      throw error;
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
      const { data, error } = await this.supabase
        .from('employees')
        .select('*')
        .eq('is_active', true);

      if (error || !data) return [];

      const normPhone = normalizePhone(managerPhone);
      return data.filter((emp: any) => {
        if (emp.role === 'admin' || emp.role === 'sales_manager') return false;
        if (managerId && emp.manager_id === managerId) return true;
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
   * - Admin: Returns requested override phone or null (unrestricted/all)
   * - Sales Manager: Returns requested phone (if in assigned team) or array of all team phones
   * - Salesperson: Strictly returns [employee.phone]
   */
  async getAccessibleSalespersonPhones(
    employee: any,
    requestedPhoneOverride?: string,
  ): Promise<{ phones: string[] | null; isManagerView?: boolean }> {
    if (!employee || employee.role === 'admin') {
      if (requestedPhoneOverride) {
        return { phones: [requestedPhoneOverride] };
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

      if (requestedPhoneOverride) {
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
    manager_id?: string;
    manager_phone?: string;
  }) {
    try {
      // Check duplicate phone
      const existing = await this.findByPhone(dto.phone);
      if (existing) {
        throw new ConflictException(`Phone ${dto.phone} already registered`);
      }

      // Check duplicate employee_id
      const existingId = await this.findByEmployeeId(dto.employee_id);
      if (existingId) {
        throw new ConflictException(
          `Employee ID ${dto.employee_id} already exists`,
        );
      }

      const insertPayload: any = {
        employee_id: dto.employee_id,
        name: dto.name,
        phone: dto.phone,
        email: dto.email || null,
        role: dto.role || 'salesperson',
        is_active: true,
        created_at: new Date().toISOString(),
      };

      if (dto.manager_id) insertPayload.manager_id = dto.manager_id;
      if (dto.manager_phone) insertPayload.manager_phone = dto.manager_phone;

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
    }>,
  ) {
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .update({ ...dto })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      this.logger.error(`Error in update for employee ${id}:`, error);
      throw error;
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

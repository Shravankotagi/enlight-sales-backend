import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(private supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  async findAll() {
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .select(
          'id, employee_id, name, phone, email, role, is_active, created_at',
        )
        .order('employee_id', { ascending: true });
      if (error) throw error;
      return data;
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

  async create(dto: {
    employee_id: string;
    name: string;
    phone: string;
    email?: string;
    role?: string;
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

      const { data, error } = await this.supabase
        .from('employees')
        .insert({
          employee_id: dto.employee_id,
          name: dto.name,
          phone: dto.phone,
          email: dto.email || null,
          role: dto.role || 'salesperson',
          is_active: true,
          created_at: new Date().toISOString(),
        })
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
        .select('employee_id')
        .order('employee_id', { ascending: false })
        .limit(1);

      if (!data || data.length === 0) return 'EMP001';

      const last = data[0].employee_id;
      const num = parseInt(last.replace('EMP', '')) + 1;
      return `EMP${String(num).padStart(3, '0')}`;
    } catch (error) {
      this.logger.error('Error in generateNextEmployeeId:', error);
      return 'EMP001';
    }
  }
}

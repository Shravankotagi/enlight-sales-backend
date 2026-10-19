import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';
import { assertPermission } from '../../common/guards/permission.guard';

@Controller('employees')
@UseGuards(JwtAuthGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  // GET /employees - list all employees (scoped by caller role)
  @Get()
  async findAll(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('mode') mode?: string,
  ) {
    return this.employeesService.findAll(
      employee,
      salespersonPhoneOverride,
      mode,
    );
  }

  // GET /employees/next-id - get next auto employee ID
  @Get('next-id')
  async getNextId() {
    const id = await this.employeesService.generateNextEmployeeId();
    return { next_employee_id: id };
  }

  // POST /employees - create employee (admin only)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentEmployee() employee: any,
    @Body()
    body: {
      employee_id?: string;
      name: string;
      phone: string;
      email?: string;
      role?: string;
      manager_id?: string;
      manager_phone?: string;
    },
  ) {
    assertPermission(employee, 'staff.create');

    // Auto-generate employee_id if not provided
    const employeeId =
      body.employee_id ||
      (await this.employeesService.generateNextEmployeeId());

    return this.employeesService.create({
      ...body,
      employee_id: employeeId,
    });
  }

  // PATCH /employees/:id - update employee (admin only)
  @Patch(':id')
  async update(
    @CurrentEmployee() employee: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    assertPermission(employee, 'staff.manage');
    if (
      employee?.id === id &&
      body?.role &&
      body.role !== employee.role &&
      employee.permissions?.['staff.manage_acl']
    ) {
      throw new ForbiddenException('You cannot change your own role.');
    }
    return this.employeesService.update(id, body);
  }

  // PATCH /employees/:id/deactivate - deactivate employee (admin only)
  @Patch(':id/deactivate')
  async deactivate(@CurrentEmployee() employee: any, @Param('id') id: string) {
    assertPermission(employee, 'staff.manage');
    return this.employeesService.deactivate(id);
  }

  // DELETE /employees/:id - completely delete employee and associated records (admin only)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@CurrentEmployee() employee: any, @Param('id') id: string) {
    assertPermission(employee, 'staff.delete');
    return this.employeesService.delete(id, employee);
  }
}

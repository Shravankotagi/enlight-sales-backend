import {
  Controller,
  Get,
  Post,
  Patch,
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
    if (!employee || employee.role !== 'admin') {
      throw new ForbiddenException(
        'Access Denied: Only administrators can create staff accounts.',
      );
    }

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
    if (!employee || employee.role !== 'admin') {
      throw new ForbiddenException(
        'Access Denied: Only administrators can update staff accounts.',
      );
    }
    return this.employeesService.update(id, body);
  }

  // PATCH /employees/:id/deactivate - deactivate employee (admin only)
  @Patch(':id/deactivate')
  async deactivate(@CurrentEmployee() employee: any, @Param('id') id: string) {
    if (!employee || employee.role !== 'admin') {
      throw new ForbiddenException(
        'Access Denied: Only administrators can deactivate staff accounts.',
      );
    }
    return this.employeesService.deactivate(id);
  }
}

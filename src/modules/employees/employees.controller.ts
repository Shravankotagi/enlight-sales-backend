import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  // GET /employees — list all employees (admin only)
  @Get()
  async findAll() {
    return this.employeesService.findAll();
  }

  // GET /employees/next-id — get next auto employee ID
  @Get('next-id')
  async getNextId() {
    const id = await this.employeesService.generateNextEmployeeId();
    return { next_employee_id: id };
  }

  // POST /employees — create employee (admin only)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body()
    body: {
      employee_id?: string;
      name: string;
      phone: string;
      email?: string;
      role?: string;
    },
  ) {
    // Auto-generate employee_id if not provided
    const employeeId =
      body.employee_id ||
      (await this.employeesService.generateNextEmployeeId());

    return this.employeesService.create({
      ...body,
      employee_id: employeeId,
    });
  }

  // PATCH /employees/:id — update employee
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.employeesService.update(id, body);
  }

  // PATCH /employees/:id/deactivate — deactivate employee
  @Patch(':id/deactivate')
  async deactivate(@Param('id') id: string) {
    return this.employeesService.deactivate(id);
  }
}

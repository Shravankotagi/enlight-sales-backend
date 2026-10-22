import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { EmployeesService } from '../employees/employees.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';
import { assertPermission } from '../../common/guards/permission.guard';

@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly employeesService: EmployeesService,
  ) {}

  @Post()
  async create(@CurrentEmployee() employee: any, @Body() body: any) {
    assertPermission(employee, 'customers.create');
    return this.customersService.createCustomer(body, employee);
  }

  @Post('import')
  async importClients(
    @CurrentEmployee() employee: any,
    @Body()
    body: {
      default_salesperson_phone?: string;
      clients: Array<{
        customer_name: string;
        contact_person?: string;
        customer_phone?: string;
        customer_email?: string;
        address?: string;
        customer_gst?: string;
        industry?: string;
        assigned_salesperson_email?: string;
        assigned_salesperson_name?: string;
        assigned_salesperson_zoho_id?: string;
        assigned_salesperson_phone?: string;
        assigned_salesperson?: string;
        salesperson_phone?: string;
      }>;
    },
  ) {
    assertPermission(employee, 'clients.import_csv');

    return this.customersService.importClients(
      body.clients,
      body.default_salesperson_phone,
    );
  }

  @Get()
  async findAll(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('mode') mode?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    return this.customersService.findAll(phones === null ? undefined : phones);
  }

  @Get('churn-risk')
  async getChurnRisk(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('mode') mode?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    return this.customersService.getChurnRisk(
      phones === null ? undefined : phones,
    );
  }

  @Get('reorder-queue')
  async getReorderQueue(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('mode') mode?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    return this.customersService.getReorderQueue(
      phones === null ? undefined : phones,
    );
  }

  @Get('loss-analytics')
  async getLossAnalytics(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('mode') mode?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    return this.customersService.getLossAnalytics(
      phones === null ? undefined : phones,
    );
  }

  @Get(':id')
  async findOne(
    @CurrentEmployee() employee: any,
    @Param('id') id: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
      );

    return this.customersService.findOne(
      id,
      phones === null ? undefined : phones,
    );
  }

  @Patch(':id')
  async update(
    @CurrentEmployee() employee: any,
    @Param('id') id: string,
    @Body() body: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    if (body.is_active !== undefined) {
      assertPermission(employee, 'customers.toggle_active');
    }
    if (Object.keys(body || {}).some((key) => key !== 'is_active')) {
      assertPermission(employee, 'customers.edit');
    }

    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
      );

    return this.customersService.updateCustomer(
      id,
      body,
      phones === null ? undefined : phones,
    );
  }

  @Delete(':id')
  async deleteCustomer(
    @CurrentEmployee() employee: any,
    @Param('id') id: string,
  ) {
    assertPermission(employee, 'customers.delete');

    return this.customersService.deleteCustomer(id);
  }
}

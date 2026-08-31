import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { EmployeesService } from '../employees/employees.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';

@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly employeesService: EmployeesService,
  ) {}

  @Post('import')
  async importClients(
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
        assigned_salesperson_phone?: string;
      }>;
    },
  ) {
    return this.customersService.importClients(
      body.clients,
      body.default_salesperson_phone,
    );
  }

  @Get()
  async findAll(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
      );

    return this.customersService.findAll(phones === null ? undefined : phones);
  }

  @Get('churn-risk')
  async getChurnRisk(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
      );

    return this.customersService.getChurnRisk(
      phones === null ? undefined : phones,
    );
  }

  @Get('reorder-queue')
  async getReorderQueue(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
      );

    return this.customersService.getReorderQueue(
      phones === null ? undefined : phones,
    );
  }

  @Get('loss-analytics')
  async getLossAnalytics(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
      );

    return this.customersService.getLossAnalytics(
      phones === null ? undefined : phones,
    );
  }

  @Get(':id')
  async findOne(@CurrentEmployee() employee: any, @Param('id') id: string) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(employee);

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
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(employee);

    return this.customersService.updateCustomer(
      id,
      body,
      phones === null ? undefined : phones,
    );
  }
}

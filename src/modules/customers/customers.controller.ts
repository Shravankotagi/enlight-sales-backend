import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';

@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  async findAll(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const salesperson_phone =
      employee.role === 'admin'
        ? salespersonPhoneOverride || undefined
        : employee.phone;

    return this.customersService.findAll(salesperson_phone);
  }

  @Get('churn-risk')
  async getChurnRisk(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const salesperson_phone =
      employee.role === 'admin'
        ? salespersonPhoneOverride || undefined
        : employee.phone;

    return this.customersService.getChurnRisk(salesperson_phone);
  }

  @Get('reorder-queue')
  async getReorderQueue(@CurrentEmployee() employee: any) {
    const phone = employee.role === 'admin' ? undefined : employee.phone;
    return this.customersService.getReorderQueue(phone);
  }

  @Get('loss-analytics')
  async getLossAnalytics(@CurrentEmployee() employee: any) {
    const phone = employee.role === 'admin' ? undefined : employee.phone;
    return this.customersService.getLossAnalytics(phone);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }
}

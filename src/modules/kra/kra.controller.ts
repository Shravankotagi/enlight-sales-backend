import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { KraService } from './kra.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';

@Controller('kra')
@UseGuards(JwtAuthGuard)
export class KraController {
  constructor(private readonly kraService: KraService) {}

  @Get('dashboard')
  async getDashboard(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    const salesperson_phone =
      employee.role === 'admin'
        ? salespersonPhoneOverride || undefined
        : employee.phone;

    return this.kraService.getDashboard(
      salesperson_phone,
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
    );
  }

  @Get('logs')
  async getLogs(
    @CurrentEmployee() employee: any,
    @Query('kra_number') kraNumber?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const salesperson_phone =
      employee.role === 'admin'
        ? salespersonPhoneOverride || undefined
        : employee.phone;

    return this.kraService.getLogs(
      kraNumber ? parseInt(kraNumber) : undefined,
      salesperson_phone,
    );
  }
}

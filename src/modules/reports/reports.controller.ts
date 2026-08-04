import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // GET /reports/monthly
  @Get('monthly')
  async getMonthlySales(
    @CurrentEmployee() employee: any,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const salesperson_phone =
      employee.role === 'admin'
        ? salespersonPhoneOverride || undefined
        : employee.phone;

    return this.reportsService.getMonthlySalesReport(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
      salesperson_phone,
    );
  }

  // GET /reports/salesperson
  @Get('salesperson')
  async getSalesperson(
    @CurrentEmployee() employee: any,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.reportsService.getSalespersonReport(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
    );
  }

  // GET /reports/funnel
  @Get('funnel')
  async getFunnel(
    @CurrentEmployee() employee: any,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const salesperson_phone =
      employee.role === 'admin'
        ? salespersonPhoneOverride || undefined
        : employee.phone;

    return this.reportsService.getFunnelReport(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
      salesperson_phone,
    );
  }

  // GET /reports/sku
  @Get('sku')
  async getSku(
    @CurrentEmployee() employee: any,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const salesperson_phone =
      employee.role === 'admin'
        ? salespersonPhoneOverride || undefined
        : employee.phone;

    return this.reportsService.getSkuReport(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
      salesperson_phone,
    );
  }
}

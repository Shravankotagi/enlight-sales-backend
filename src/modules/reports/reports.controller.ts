import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // GET /reports/monthly
  @Get('monthly')
  async getMonthlySales(
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.reportsService.getMonthlySalesReport(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
    );
  }

  // GET /reports/salesperson
  @Get('salesperson')
  async getSalesperson(
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
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.reportsService.getFunnelReport(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
    );
  }

  // GET /reports/sku
  @Get('sku')
  async getSku(@Query('month') month?: string, @Query('year') year?: string) {
    return this.reportsService.getSkuReport(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
    );
  }
}

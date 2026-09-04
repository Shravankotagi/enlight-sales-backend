import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { EmployeesService } from '../employees/employees.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly employeesService: EmployeesService,
  ) {}

  // GET /reports/monthly
  @Get('monthly')
  async getMonthlySales(
    @CurrentEmployee() employee: any,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('mode') mode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('all_time') allTime?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    return this.reportsService.getMonthlySalesReport(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
      phones === null ? undefined : phones,
      from,
      to,
      allTime === 'true',
    );
  }

  // GET /reports/salesperson
  @Get('salesperson')
  async getSalesperson(
    @CurrentEmployee() employee: any,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('mode') mode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('all_time') allTime?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    return this.reportsService.getSalespersonReport(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
      from,
      to,
      phones === null ? undefined : phones,
      allTime === 'true',
    );
  }

  // GET /reports/funnel
  @Get('funnel')
  async getFunnel(
    @CurrentEmployee() employee: any,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('mode') mode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('all_time') allTime?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    return this.reportsService.getFunnelReport(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
      phones === null ? undefined : phones,
      from,
      to,
      allTime === 'true',
    );
  }

  // GET /reports/sku
  @Get('sku')
  async getSku(
    @CurrentEmployee() employee: any,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('mode') mode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('all_time') allTime?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    return this.reportsService.getSkuReport(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
      phones === null ? undefined : phones,
      from,
      to,
      allTime === 'true',
    );
  }

  // GET /reports/overview (Consolidated high-speed endpoint for single-trip report loading)
  @Get('overview')
  async getOverview(
    @CurrentEmployee() employee: any,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('mode') mode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('all_time') allTime?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    return this.reportsService.getOverviewReport(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
      phones === null ? undefined : phones,
      from,
      to,
      allTime === 'true',
    );
  }
}

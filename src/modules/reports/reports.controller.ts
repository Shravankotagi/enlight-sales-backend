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
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('all_time') allTime?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
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
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('all_time') allTime?: string,
  ) {
    if (employee.role === 'admin') {
      return this.reportsService.getSalespersonReport(
        month ? parseInt(month) : undefined,
        year ? parseInt(year) : undefined,
        from,
        to,
        undefined,
        allTime === 'true',
      );
    }

    if (employee.role === 'sales_manager' || employee.role === 'manager') {
      const assigned = await this.employeesService.getAssignedSalespersons(
        employee.id,
        employee.phone,
      );
      if (assigned.length === 0) {
        return [];
      }
      const teamPhones = assigned.map((a: any) => a.phone).filter(Boolean);
      return this.reportsService.getSalespersonReport(
        month ? parseInt(month) : undefined,
        year ? parseInt(year) : undefined,
        from,
        to,
        teamPhones,
        allTime === 'true',
      );
    }

    return [];
  }

  // GET /reports/funnel
  @Get('funnel')
  async getFunnel(
    @CurrentEmployee() employee: any,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('all_time') allTime?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
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
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('all_time') allTime?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
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
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('all_time') allTime?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
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

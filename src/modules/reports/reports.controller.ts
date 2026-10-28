import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { EmployeesService } from '../employees/employees.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';
import { hasPermission } from '../../common/guards/permission.guard';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly employeesService: EmployeesService,
  ) {}

  private reportAccess(employee: any) {
    return {
      customers: hasPermission(employee, 'customers.view'),
      inquiries: hasPermission(employee, 'inquiries.view'),
      orders: hasPermission(employee, 'orders.view'),
      visits: hasPermission(employee, 'visits.view'),
      complaints: hasPermission(employee, 'complaints.view'),
    };
  }

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
    const access = this.reportAccess(employee);
    if (!access.orders && !access.inquiries) {
      return {
        summary: {
          total_revenue: 0,
          deals_won: 0,
          deals_lost: 0,
          deals_pending: 0,
          total_deals: 0,
          conversion_rate: 0,
          total_inquiries: 0,
        },
        by_customer: [],
        by_type: [],
        lost_reasons: {},
      };
    }
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
    const access = this.reportAccess(employee);
    if (
      !access.orders &&
      !access.visits &&
      !access.complaints &&
      !access.customers
    ) {
      return [];
    }
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
    const access = this.reportAccess(employee);
    if (!access.inquiries) {
      return { funnel: [], max_count: 0, overall_win_rate: 0 };
    }
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
    const access = this.reportAccess(employee);
    if (!access.orders) return { skus: [] };
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
      this.reportAccess(employee),
    );
  }
}

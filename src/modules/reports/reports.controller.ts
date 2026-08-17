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
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
      );

    return this.reportsService.getMonthlySalesReport(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
      phones || undefined,
      from,
      to,
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
  ) {
    if (employee.role === 'admin') {
      return this.reportsService.getSalespersonReport(
        month ? parseInt(month) : undefined,
        year ? parseInt(year) : undefined,
        from,
        to,
      );
    }

    if (employee.role === 'sales_manager' || employee.role === 'manager') {
      const assigned = await this.employeesService.getAssignedSalespersons(
        employee.id,
        employee.phone,
      );
      const teamPhones = [
        employee.phone,
        ...assigned.map((a: any) => a.phone).filter(Boolean),
      ];
      return this.reportsService.getSalespersonReport(
        month ? parseInt(month) : undefined,
        year ? parseInt(year) : undefined,
        from,
        to,
        teamPhones,
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
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
      );

    return this.reportsService.getFunnelReport(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
      phones || undefined,
      from,
      to,
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
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
      );

    return this.reportsService.getSkuReport(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
      phones || undefined,
      from,
      to,
    );
  }
}

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ActivityLogsService } from './activity-logs.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';
import { EmployeesService } from '../employees/employees.service';
import { hasPermission } from '../../common/guards/permission.guard';

@Controller('activity-logs')
@UseGuards(JwtAuthGuard)
export class ActivityLogsController {
  constructor(
    private readonly activityLogsService: ActivityLogsService,
    private readonly employeesService: EmployeesService,
  ) {}

  @Get()
  async getLogs(
    @CurrentEmployee() employee: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('module') module?: string,
    @Query('search') search?: string,
    @Query('action_type') actionType?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('mode') mode?: string,
    @Query('limit') limit?: number,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    const canSeeStaff =
      hasPermission(employee, 'staff.view') || employee?.role === 'admin';

    return this.activityLogsService.getActivityLogs(
      { from, to, module, search, action_type: actionType, limit },
      phones,
      { includeStaffModules: canSeeStaff, includeAuth: canSeeStaff },
    );
  }

  @Get('counts')
  async getCounts(
    @CurrentEmployee() employee: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('mode') mode?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );
    const canSeeStaff =
      hasPermission(employee, 'staff.view') || employee?.role === 'admin';

    return this.activityLogsService.countActivityLogs({ from, to }, phones, {
      includeAuth: canSeeStaff,
      includeStaffModules: canSeeStaff,
    });
  }
}

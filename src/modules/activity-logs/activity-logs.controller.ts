import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ActivityLogsService } from './activity-logs.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';
import { EmployeesService } from '../employees/employees.service';

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
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('limit') limit?: number,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
      );

    return this.activityLogsService.getActivityLogs(
      { from, to, module, search, limit },
      phones,
    );
  }
}

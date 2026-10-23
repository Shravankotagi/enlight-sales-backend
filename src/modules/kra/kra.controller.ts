import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { KraService } from './kra.service';
import { EmployeesService } from '../employees/employees.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';
import {
  assertPermission,
  hasPermission,
} from '../../common/guards/permission.guard';

function isFollowUpStatusOnly(body: any): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return (
    keys.length === 1 &&
    keys[0] === 'follow_up_status' &&
    (body.follow_up_status === 'completed' ||
      body.follow_up_status === 'pending')
  );
}

@Controller('kra')
@UseGuards(JwtAuthGuard)
export class KraController {
  constructor(
    private readonly kraService: KraService,
    private readonly employeesService: EmployeesService,
  ) {}

  @Get('dashboard')
  async getDashboard(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('all_time') allTime?: string,
    @Query('mode') mode?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    return this.kraService.getDashboard(
      phones === null ? undefined : phones,
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
      from,
      to,
      allTime === 'true',
    );
  }

  @Get('sheets')
  async getSheets(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('mode') mode?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    return this.kraService.getSheets(
      phones === null ? undefined : phones,
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
      from,
      to,
    );
  }

  @Get('logs')
  async getLogs(
    @CurrentEmployee() employee: any,
    @Query('kra_number') kraNumber?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('mode') mode?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    return this.kraService.getLogs(
      kraNumber ? parseInt(kraNumber) : undefined,
      phones === null ? undefined : phones,
    );
  }

  @Get('action-queue')
  async getActionQueue(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('all_time') allTime?: string,
    @Query('mode') mode?: string,
  ) {
    const isAdmin =
      employee?.dataScope === 'all' ||
      employee?.role === 'admin' ||
      employee?.isInternal;
    const parsedMonth = month ? parseInt(month) : undefined;
    const parsedYear = year ? parseInt(year) : undefined;

    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    return this.kraService.getActionQueue(
      phones === null ? undefined : phones,
      isAdmin && !salespersonPhoneOverride && mode !== 'personal',
      parsedMonth,
      parsedYear,
      from,
      to,
      allTime === 'true',
    );
  }

  @Get('complaints')
  async getComplaints(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('mode') mode?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    return this.kraService.getComplaints(
      phones === null ? undefined : phones,
      from,
      to,
    );
  }

  @Get('complaints/:id/attachments')
  async getComplaintAttachments(
    @CurrentEmployee() employee: any,
    @Param('id') id: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(employee);
    return this.kraService.getComplaintAttachments(
      id,
      phones === null ? undefined : phones,
    );
  }

  @Post('complaints')
  async createComplaint(@CurrentEmployee() employee: any, @Body() body: any) {
    assertPermission(employee, 'complaints.log');
    return this.kraService.createComplaint(body, employee?.phone);
  }

  @Patch('complaints/:id')
  async updateComplaint(
    @CurrentEmployee() employee: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    assertPermission(employee, 'complaints.update');
    const status = String(
      body?.status || body?.complaint_status || '',
    ).toLowerCase();
    if (status === 'resolved' || status === 'closed') {
      assertPermission(employee, 'complaints.resolve');
    }
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(employee);
    return this.kraService.updateComplaint(id, body, phones);
  }

  @Get('visits')
  async getVisits(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('mode') mode?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    return this.kraService.getVisits(
      phones === null ? undefined : phones,
      from,
      to,
    );
  }

  @Post('visits/otp/request')
  async requestVisitOtp(@Body() body: { phone?: string }) {
    return this.kraService.requestVisitOtp(body?.phone || '');
  }

  @Post('visits/otp/verify')
  async verifyVisitOtp(@Body() body: { phone?: string; otp?: string }) {
    return this.kraService.verifyVisitOtp(body?.phone || '', body?.otp || '');
  }

  @Get('visits/reverse-geocode')
  async reverseGeocodeVisit(
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    return this.kraService.reverseGeocodeVisit(lat, lng);
  }

  @Post('visits')
  async createVisit(@CurrentEmployee() employee: any, @Body() body: any) {
    assertPermission(employee, 'visits.log');
    return this.kraService.createVisit(body, employee?.phone);
  }

  @Patch('visits/:id')
  async updateVisit(
    @CurrentEmployee() employee: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const role = (employee?.role || '').toLowerCase();
    const isAuthorized =
      role.includes('admin') ||
      role.includes('manager') ||
      hasPermission(employee, 'visits.update') ||
      isFollowUpStatusOnly(body);
    if (!isAuthorized) {
      throw new ForbiddenException(
        'Access Denied: Field visits can only be updated by Sales Managers and Administrators.',
      );
    }

    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        undefined,
        undefined,
        'visits.scope_assigned',
      );
    return this.kraService.updateVisit(
      id,
      body,
      phones === null ? undefined : phones,
    );
  }

  @Delete('visits/:id')
  async deleteVisit(@CurrentEmployee() employee: any, @Param('id') id: string) {
    assertPermission(employee, 'visits.delete');

    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        undefined,
        undefined,
        'visits.scope_assigned',
      );
    return this.kraService.deleteVisit(
      id,
      phones === null ? undefined : phones,
    );
  }
}

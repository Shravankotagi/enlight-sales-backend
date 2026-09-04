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
} from '@nestjs/common';
import { KraService } from './kra.service';
import { EmployeesService } from '../employees/employees.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';

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
    const isAdmin = employee.role === 'admin';
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
      isAdmin && !salespersonPhoneOverride,
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

  @Post('complaints')
  async createComplaint(@CurrentEmployee() employee: any, @Body() body: any) {
    return this.kraService.createComplaint(body, employee?.phone);
  }

  @Patch('complaints/:id')
  async updateComplaint(
    @CurrentEmployee() employee: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
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

  @Post('visits')
  async createVisit(@CurrentEmployee() employee: any, @Body() body: any) {
    return this.kraService.createVisit(body, employee?.phone);
  }

  @Patch('visits/:id')
  async updateVisit(
    @CurrentEmployee() employee: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(employee);
    return this.kraService.updateVisit(
      id,
      body,
      phones === null ? undefined : phones,
    );
  }

  @Delete('visits/:id')
  async deleteVisit(@CurrentEmployee() employee: any, @Param('id') id: string) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(employee);
    return this.kraService.deleteVisit(
      id,
      phones === null ? undefined : phones,
    );
  }
}

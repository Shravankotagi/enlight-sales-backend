import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { KraService } from './kra.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';

@Controller('kra')
@UseGuards(JwtAuthGuard)
export class KraController {
  constructor(private readonly kraService: KraService) {}

  @Get('dashboard')
  async getDashboard(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const salesperson_phone =
      employee.role === 'admin'
        ? salespersonPhoneOverride || undefined
        : employee.phone;

    return this.kraService.getDashboard(
      salesperson_phone,
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
      from,
      to,
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
  ) {
    const salesperson_phone =
      employee.role === 'admin'
        ? salespersonPhoneOverride || undefined
        : employee.phone;

    return this.kraService.getSheets(
      salesperson_phone,
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
  ) {
    const salesperson_phone =
      employee.role === 'admin'
        ? salespersonPhoneOverride || undefined
        : employee.phone;

    return this.kraService.getLogs(
      kraNumber ? parseInt(kraNumber) : undefined,
      salesperson_phone,
    );
  }

  @Get('action-queue')
  async getActionQueue(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    const isAdmin = employee.role === 'admin';
    const parsedMonth = month ? parseInt(month) : undefined;
    const parsedYear = year ? parseInt(year) : undefined;

    // If admin is impersonating, use the override phone and treat them as a salesperson
    if (isAdmin && salespersonPhoneOverride) {
      return this.kraService.getActionQueue(
        salespersonPhoneOverride,
        false,
        parsedMonth,
        parsedYear,
      );
    }

    return this.kraService.getActionQueue(
      employee.phone,
      isAdmin,
      parsedMonth,
      parsedYear,
    );
  }

  @Get('complaints')
  async getComplaints(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const targetPhone =
      employee.role === 'admin'
        ? salespersonPhoneOverride || undefined
        : employee.phone;
    return this.kraService.getComplaints(targetPhone);
  }

  @Post('complaints')
  async createComplaint(@CurrentEmployee() employee: any, @Body() body: any) {
    return this.kraService.createComplaint(body, employee.phone);
  }

  @Patch('complaints/:id')
  async updateComplaint(
    @Param('id') id: string,
    @Body() body: { status: string; resolution_notes?: string },
  ) {
    return this.kraService.updateComplaintStatus(
      id,
      body.status,
      body.resolution_notes,
    );
  }

  @Get('visits')
  async getVisits(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const targetPhone =
      employee.role === 'admin'
        ? salespersonPhoneOverride || undefined
        : employee.phone;
    return this.kraService.getVisits(targetPhone);
  }

  @Post('visits')
  async createVisit(@CurrentEmployee() employee: any, @Body() body: any) {
    return this.kraService.createVisit(body, employee.phone);
  }
}

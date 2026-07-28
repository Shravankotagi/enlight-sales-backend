import { Controller, Get, Query } from '@nestjs/common';
import { KraService } from './kra.service';

@Controller('kra')
export class KraController {
  constructor(private readonly kraService: KraService) {}

  @Get('dashboard')
  async getDashboard(
    @Query('salesperson_phone') salespersonPhone?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.kraService.getDashboard(
      salespersonPhone,
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
    );
  }

  @Get('logs')
  async getLogs(
    @Query('kra_number') kraNumber?: string,
    @Query('salesperson_phone') salespersonPhone?: string,
  ) {
    return this.kraService.getLogs(
      kraNumber ? parseInt(kraNumber) : undefined,
      salespersonPhone,
    );
  }
}

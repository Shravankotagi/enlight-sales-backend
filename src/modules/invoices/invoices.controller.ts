import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';
import { InvoicesService, type DispatchFile } from './invoices.service';

@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  list(@CurrentEmployee() employee: any) {
    return this.invoices.list(employee);
  }

  @Post()
  submit(
    @CurrentEmployee() employee: any,
    @Body() body: { template?: string; files?: DispatchFile[] },
  ) {
    return this.invoices.submit(employee, body);
  }

  @Post(':id/approve')
  approve(@CurrentEmployee() employee: any, @Param('id') id: string) {
    return this.invoices.approve(employee, id);
  }
}

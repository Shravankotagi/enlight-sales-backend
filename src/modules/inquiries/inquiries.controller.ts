import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { InquiriesService } from './inquiries.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';

@Controller('inquiries')
@UseGuards(JwtAuthGuard)
export class InquiriesController {
  constructor(private readonly inquiriesService: InquiriesService) {}

  @Get()
  async findAll(
    @CurrentEmployee() employee: any,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const data = await this.inquiriesService.findAll({ status, from, to });
    const targetPhone =
      employee.role === 'admin' ? salespersonPhoneOverride : employee.phone;

    if (targetPhone) {
      return data.filter((inq: any) => inq.sender_phone === targetPhone);
    }
    return data;
  }

  @Get('review-queue')
  async getReviewQueue(@CurrentEmployee() employee: any) {
    const data = await this.inquiriesService.findReviewQueue();
    if (employee.role !== 'admin') {
      return data.filter((inq: any) => inq.sender_phone === employee.phone);
    }
    return data;
  }

  @Get('stats')
  async getStats(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const targetPhone =
      employee.role === 'admin' ? salespersonPhoneOverride : employee.phone;

    const data = await this.inquiriesService.findAll();
    const filtered = targetPhone
      ? data.filter((inq: any) => inq.sender_phone === targetPhone)
      : data;

    return {
      total: filtered.length,
      pending: filtered.filter((i: any) => i.status === 'pending').length || 0,
      processed:
        filtered.filter((i: any) => i.status === 'processed').length || 0,
      review: filtered.filter((i: any) => i.status === 'review').length || 0,
      by_channel: {
        whatsapp:
          filtered.filter((i: any) => i.source_channel === 'whatsapp').length ||
          0,
      },
    };
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.inquiriesService.updateStatus(id, body.status);
  }
}

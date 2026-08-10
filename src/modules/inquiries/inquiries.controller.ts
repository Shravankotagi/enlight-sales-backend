import {
  Controller,
  Get,
  Post,
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
    const salespersonPhone =
      employee.role === 'admin'
        ? salespersonPhoneOverride || undefined
        : employee.phone;

    return this.inquiriesService.findAll({
      status,
      from,
      to,
      salespersonPhone,
    });
  }

  @Get('review-queue')
  async getReviewQueue(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const salespersonPhone =
      employee.role === 'admin'
        ? salespersonPhoneOverride || undefined
        : employee.phone;

    return this.inquiriesService.findReviewQueue(salespersonPhone);
  }

  @Get('stats')
  async getStats(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const salespersonPhone =
      employee.role === 'admin'
        ? salespersonPhoneOverride || undefined
        : employee.phone;

    return this.inquiriesService.getStats(salespersonPhone);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.inquiriesService.updateStatus(id, body.status);
  }

  @Post()
  async createInquiry(@CurrentEmployee() employee: any, @Body() body: any) {
    return this.inquiriesService.createInquiry(body, employee.phone);
  }
}

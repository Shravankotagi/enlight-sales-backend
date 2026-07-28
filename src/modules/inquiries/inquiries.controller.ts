import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { InquiriesService } from './inquiries.service';

@Controller('inquiries')
export class InquiriesController {
  constructor(private readonly inquiriesService: InquiriesService) {}

  @Get()
  async findAll(
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.inquiriesService.findAll({ status, from, to });
  }

  @Get('review-queue')
  async getReviewQueue() {
    return this.inquiriesService.findReviewQueue();
  }

  @Get('stats')
  async getStats() {
    return this.inquiriesService.getStats();
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

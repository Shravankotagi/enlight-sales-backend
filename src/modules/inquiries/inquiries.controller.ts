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

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.inquiriesService.findOne(id);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; details?: any },
  ) {
    return this.inquiriesService.updateStatus(id, body.status, body.details);
  }

  @Post()
  async createInquiry(@CurrentEmployee() employee: any, @Body() body: any) {
    return this.inquiriesService.createInquiry(body, employee.phone);
  }

  @Post('send-quotation/:id')
  async sendQuotation(@Param('id') id: string, @Body() body: any) {
    return this.inquiriesService.sendQuotation(id, body);
  }

  @Post('parse-document')
  async parseDocument(
    @Body() body: { file_base64: string; mime_type: string },
  ) {
    return this.inquiriesService.parseDocumentWithGemini(
      body.file_base64,
      body.mime_type,
    );
  }
}

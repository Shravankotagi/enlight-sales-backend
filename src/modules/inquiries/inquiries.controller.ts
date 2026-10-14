import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { InquiriesService } from './inquiries.service';
import { EmployeesService } from '../employees/employees.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';
import {
  isProcurementManager,
  isProcurementRole,
} from '../../common/utils/roles';

@Controller('inquiries')
@UseGuards(JwtAuthGuard)
export class InquiriesController {
  constructor(
    private readonly inquiriesService: InquiriesService,
    private readonly employeesService: EmployeesService,
  ) {}

  private denyProcurement(action: string): never {
    throw new ForbiddenException(
      `Access Denied: Procurement roles cannot ${action}.`,
    );
  }

  @Get()
  async findAll(
    @CurrentEmployee() employee: any,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('mode') mode?: string,
  ) {
    if (isProcurementRole(employee?.role)) {
      const procurementScope =
        await this.employeesService.getAccessibleProcurementIds(employee);
      return this.inquiriesService.findAll({
        status,
        from,
        to,
        procurementScope,
      });
    }

    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    if (Array.isArray(phones) && phones.length === 0) {
      return [];
    }

    return this.inquiriesService.findAll({
      status,
      from,
      to,
      salespersonPhones: phones || undefined,
    });
  }

  @Get('review-queue')
  async getReviewQueue(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('mode') mode?: string,
  ) {
    if (isProcurementRole(employee?.role)) {
      const procurementScope =
        await this.employeesService.getAccessibleProcurementIds(employee);
      return this.inquiriesService.findReviewQueue(
        undefined,
        from,
        to,
        procurementScope,
      );
    }

    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    if (Array.isArray(phones) && phones.length === 0) {
      return [];
    }

    return this.inquiriesService.findReviewQueue(phones || undefined, from, to);
  }

  @Get('stats')
  async getStats(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('mode') mode?: string,
  ) {
    if (isProcurementRole(employee?.role)) {
      const procurementScope =
        await this.employeesService.getAccessibleProcurementIds(employee);
      return this.inquiriesService.getStats(
        undefined,
        from,
        to,
        procurementScope,
      );
    }

    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
        mode,
      );

    if (Array.isArray(phones) && phones.length === 0) {
      return {
        total: 0,
        pending: 0,
        processed: 0,
        review: 0,
        by_channel: {
          whatsapp: 0,
        },
      };
    }

    return this.inquiriesService.getStats(phones || undefined, from, to);
  }

  @Get(':id')
  async findOne(@CurrentEmployee() employee: any, @Param('id') id: string) {
    if (isProcurementRole(employee?.role)) {
      const procurementScope =
        await this.employeesService.getAccessibleProcurementIds(employee);
      return this.inquiriesService.findOne(id, null, procurementScope);
    }
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(employee);
    return this.inquiriesService.findOne(id, phones);
  }

  @Patch(':id/procurement-assignee')
  async assignProcurementOwner(
    @CurrentEmployee() employee: any,
    @Param('id') id: string,
    @Body() body: { procurement_employee_id?: string | null },
  ) {
    const assigneeId = body?.procurement_employee_id || null;
    if (employee?.role === 'admin') {
      return this.inquiriesService.assignProcurement(id, assigneeId, {
        ids: [],
        includeUnassignedPool: true,
        unrestricted: true,
      });
    }
    if (!isProcurementManager(employee?.role)) {
      this.denyProcurement('assign a procurement owner');
    }
    const scope =
      await this.employeesService.getAccessibleProcurementIds(employee);
    return this.inquiriesService.assignProcurement(id, assigneeId, scope);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @CurrentEmployee() employee: any,
    @Param('id') id: string,
    @Body() body: { status: string; details?: any },
  ) {
    if (isProcurementRole(employee?.role)) {
      const procurementScope =
        await this.employeesService.getAccessibleProcurementIds(employee);
      return this.inquiriesService.updateStatus(
        id,
        body.status,
        body.details,
        null,
        procurementScope,
      );
    }
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(employee);
    return this.inquiriesService.updateStatus(
      id,
      body.status,
      body.details,
      phones,
    );
  }

  @Post()
  async createInquiry(@CurrentEmployee() employee: any, @Body() body: any) {
    if (isProcurementRole(employee?.role)) {
      this.denyProcurement('create inquiries');
    }
    return this.inquiriesService.createInquiry(body, employee.phone);
  }

  @Post('send-quotation/:id')
  async sendQuotation(
    @CurrentEmployee() employee: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    if (isProcurementRole(employee?.role)) {
      this.denyProcurement('send quotations');
    }
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(employee);
    return this.inquiriesService.sendQuotation(id, body, phones, employee);
  }

  @Post('quotation-preview/:id')
  async previewQuotation(
    @CurrentEmployee() employee: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    if (isProcurementRole(employee?.role)) {
      this.denyProcurement('preview quotations');
    }
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(employee);
    return this.inquiriesService.previewQuotation(id, body, employee, phones);
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

  @Post('parse-text')
  async parseText(@Body() body: { text: string }) {
    return this.inquiriesService.parseTextWithGemini(body.text);
  }

  @Post('generate-pdf')
  async generatePdf(@Body() body: any, @Res() res: any) {
    const buffer = await this.inquiriesService.generateQuotationPdfBuffer(body);
    const filename = `${body.piNumber || 'Quotation'}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    return res.end(buffer);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteInquiry(
    @CurrentEmployee() employee: any,
    @Param('id') id: string,
  ) {
    if (
      isProcurementRole(employee?.role) &&
      !isProcurementManager(employee?.role)
    ) {
      this.denyProcurement('delete inquiries');
    }
    if (isProcurementManager(employee?.role)) {
      const procurementScope =
        await this.employeesService.getAccessibleProcurementIds(employee);
      return this.inquiriesService.deleteInquiry(id, null, {
        ...procurementScope,
        includeUnassignedPool: false,
      });
    }
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(employee);
    return this.inquiriesService.deleteInquiry(id, phones);
  }
}

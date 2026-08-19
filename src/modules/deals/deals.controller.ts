import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { DealsService } from './deals.service';
import { EmployeesService, phoneInList } from '../employees/employees.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';

@Controller('deals')
@UseGuards(JwtAuthGuard)
export class DealsController {
  constructor(
    private readonly dealsService: DealsService,
    private readonly employeesService: EmployeesService,
  ) {}

  @Get()
  async findAll(
    @CurrentEmployee() employee: any,
    @Query('stage') stage?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
      );

    if (Array.isArray(phones) && phones.length === 0) {
      return [];
    }

    const data = await this.dealsService.findAll({ stage, from, to });

    if (phones) {
      return data.filter((d: any) => phoneInList(d.salesperson_phone, phones));
    }
    return data;
  }

  @Get('pipeline')
  async getPipelineSummary(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
      );

    const stages = [
      'new_inquiry',
      'qualified',
      'quoted',
      'negotiation',
      'won',
      'lost',
    ];

    if (Array.isArray(phones) && phones.length === 0) {
      return stages.map((stage) => ({
        stage,
        count: 0,
        total_value: 0,
      }));
    }

    const deals = await this.dealsService.findAll({ from, to });
    const filtered = phones
      ? deals.filter((d: any) => phoneInList(d.salesperson_phone, phones))
      : deals;

    return stages.map((stage) => {
      const stageDeals = filtered.filter((d: any) =>
        stage === 'new_inquiry'
          ? d.stage === 'new_inquiry' || d.stage === 'review' || !d.stage
          : d.stage === stage,
      );
      return {
        stage,
        count: stageDeals.length || 0,
        total_value:
          stageDeals.reduce(
            (sum: number, d: any) => sum + (d.total_amount || 0),
            0,
          ) || 0,
      };
    });
  }

  @Get('kanban')
  async getKanbanBoard(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { phones } =
      await this.employeesService.getAccessibleSalespersonPhones(
        employee,
        salespersonPhoneOverride,
      );

    const stages = ['new_inquiry', 'qualified', 'quoted', 'negotiation'];

    if (Array.isArray(phones) && phones.length === 0) {
      return {
        new_inquiry: [],
        qualified: [],
        quoted: [],
        negotiation: [],
      };
    }

    const deals = await this.dealsService.findAll({ from, to });
    const activeDeals = deals.filter(
      (d: any) => !['won', 'lost'].includes(d.stage),
    );

    const filtered = phones
      ? activeDeals.filter((d: any) => phoneInList(d.salesperson_phone, phones))
      : activeDeals;

    return stages.reduce(
      (acc, stage) => {
        acc[stage] = filtered.filter((d: any) =>
          stage === 'new_inquiry'
            ? d.stage === 'new_inquiry' || d.stage === 'review'
            : d.stage === stage,
        );
        return acc;
      },
      {} as Record<string, any[]>,
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.dealsService.findOne(id);
  }

  @Patch(':id/stage')
  @HttpCode(HttpStatus.OK)
  async updateStage(
    @Param('id') id: string,
    @Body() body: { stage: string; lost_reason?: string },
  ) {
    return this.dealsService.updateStage(id, body.stage, body.lost_reason);
  }

  @Post('order')
  async createOrder(@CurrentEmployee() employee: any, @Body() body: any) {
    return this.dealsService.createOrder(body, employee.phone);
  }

  @Post('process-po')
  async processPo(@CurrentEmployee() employee: any, @Body() body: any) {
    return this.dealsService.processPo(body, employee.phone);
  }

  @Post('process-po-internal')
  async processPoInternal(@CurrentEmployee() employee: any, @Body() body: any) {
    const phone = body.salesperson_phone || employee?.phone || '910000000000';
    return this.dealsService.processPo(body, phone);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteDeal(@Param('id') id: string) {
    return this.dealsService.deleteDeal(id);
  }
}

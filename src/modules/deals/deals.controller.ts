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
import { DealsService } from './deals.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';

@Controller('deals')
@UseGuards(JwtAuthGuard)
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @Get()
  async findAll(
    @CurrentEmployee() employee: any,
    @Query('stage') stage?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
  ) {
    const targetPhone =
      employee.role === 'admin' ? salespersonPhoneOverride : employee.phone;

    const data = await this.dealsService.findAll({ stage, from, to });

    if (targetPhone) {
      return data.filter((d: any) => d.salesperson_phone === targetPhone);
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
    const targetPhone =
      employee.role === 'admin' ? salespersonPhoneOverride : employee.phone;

    const deals = await this.dealsService.findAll({ from, to });
    const filtered = targetPhone
      ? deals.filter((d: any) => d.salesperson_phone === targetPhone)
      : deals;

    const stages = [
      'new_inquiry',
      'qualified',
      'quoted',
      'negotiation',
      'won',
      'lost',
    ];

    return stages.map((stage) => ({
      stage,
      count: filtered.filter((d: any) => d.stage === stage).length || 0,
      total_value:
        filtered
          .filter((d: any) => d.stage === stage)
          .reduce((sum: number, d: any) => sum + (d.total_amount || 0), 0) || 0,
    }));
  }

  @Get('kanban')
  async getKanbanBoard(
    @CurrentEmployee() employee: any,
    @Query('salesperson_phone') salespersonPhoneOverride?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const targetPhone =
      employee.role === 'admin' ? salespersonPhoneOverride : employee.phone;

    const deals = await this.dealsService.findAll({ from, to });
    const activeDeals = deals.filter(
      (d: any) => !['won', 'lost'].includes(d.stage),
    );

    const filtered = targetPhone
      ? activeDeals.filter((d: any) => d.salesperson_phone === targetPhone)
      : activeDeals;

    const stages = ['new_inquiry', 'qualified', 'quoted', 'negotiation'];

    return stages.reduce(
      (acc, stage) => {
        acc[stage] = filtered.filter((d: any) => d.stage === stage);
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
}

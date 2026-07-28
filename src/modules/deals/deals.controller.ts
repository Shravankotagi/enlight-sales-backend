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
import { DealsService } from './deals.service';

@Controller('deals')
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  // GET /deals — list all deals with filters
  @Get()
  async findAll(
    @Query('stage') stage?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.dealsService.findAll({ stage, from, to });
  }

  // GET /deals/pipeline — pipeline summary by stage
  @Get('pipeline')
  async getPipelineSummary() {
    return this.dealsService.getPipelineSummary();
  }

  // GET /deals/kanban — kanban board data
  @Get('kanban')
  async getKanbanBoard() {
    return this.dealsService.getKanbanBoard();
  }

  // GET /deals/:id — single deal
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.dealsService.findOne(id);
  }

  // PATCH /deals/:id/stage — update deal stage
  @Patch(':id/stage')
  @HttpCode(HttpStatus.OK)
  async updateStage(
    @Param('id') id: string,
    @Body() body: { stage: string; lost_reason?: string },
  ) {
    return this.dealsService.updateStage(id, body.stage, body.lost_reason);
  }
}

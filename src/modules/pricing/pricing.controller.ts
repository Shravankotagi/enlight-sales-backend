import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PricingService } from './pricing.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';

@Controller('pricing')
@UseGuards(JwtAuthGuard)
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get('today')
  async getToday() {
    return this.pricingService.getTodayRateSheet();
  }

  @Get('history')
  async getHistory() {
    return this.pricingService.getHistory();
  }

  @Get('floor-margins')
  async getFloorMargins() {
    return this.pricingService.getFloorMargins();
  }

  @Post('rate-sheet')
  @HttpCode(HttpStatus.CREATED)
  async createRateSheet(
    @Body() body: { items: any[] },
    @CurrentEmployee() employee: any,
  ) {
    return this.pricingService.createRateSheet(
      body.items || [],
      employee.name || employee.phone,
    );
  }

  @Post('rate-sheet/:id/lock')
  @HttpCode(HttpStatus.OK)
  async lockRateSheet(
    @Param('id') id: string,
    @CurrentEmployee() employee: any,
  ) {
    return this.pricingService.lockRateSheet(
      id,
      employee.name || employee.phone,
    );
  }

  @Put('rate-sheet/:id')
  @HttpCode(HttpStatus.OK)
  async updateRateSheet(
    @Param('id') id: string,
    @Body() body: { items: any[] },
    @CurrentEmployee() employee: any,
  ) {
    return this.pricingService.updateRateSheet(
      id,
      body.items || [],
      employee.name || employee.phone,
    );
  }

  @Patch('floor-margins/:id')
  async updateFloorMargin(
    @Param('id') id: string,
    @Body() body: { floor_pct: number },
    @CurrentEmployee() employee: any,
  ) {
    return this.pricingService.updateFloorMargin(
      id,
      body.floor_pct,
      employee.name || employee.phone,
    );
  }

  @Post('check-margin')
  @HttpCode(HttpStatus.OK)
  async checkMargin(
    @Body()
    body: {
      sku_text: string;
      quoted_price: number;
      rate_sheet_price: number;
    },
  ) {
    return this.pricingService.checkMargin(
      body.sku_text,
      body.quoted_price,
      body.rate_sheet_price,
    );
  }
}

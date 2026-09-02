import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ZohoService } from './zoho.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';

@Controller('zoho')
@UseGuards(JwtAuthGuard)
export class ZohoController {
  constructor(private readonly zohoService: ZohoService) {}

  // GET /zoho/status - sync status
  @Get('status')
  async getStatus() {
    return this.zohoService.getSyncStatus();
  }

  // POST /zoho/sync - trigger manual auto-sync
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async triggerSync() {
    await this.zohoService.autoSyncRoutine();
    return { success: true, message: 'Auto-sync triggered' };
  }

  // POST /zoho/wipe - wipe all Bigin data
  @Post('wipe')
  @HttpCode(HttpStatus.OK)
  async wipeBigin() {
    return this.zohoService.wipeAllBiginData();
  }

  // POST /zoho/resync - full clean re-sync of all data
  @Post('resync')
  @HttpCode(HttpStatus.OK)
  async fullResync() {
    return this.zohoService.fullResyncAllData();
  }

  // POST /zoho/refresh-token - refresh Zoho token manually
  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  async refreshToken() {
    const token = await this.zohoService.refreshAccessToken();
    return { success: true, token_refreshed: !!token };
  }
}

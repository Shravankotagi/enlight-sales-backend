import { Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ZohoService } from './zoho.service';

@Controller('zoho')
export class ZohoController {
  constructor(private readonly zohoService: ZohoService) {}

  // GET /zoho/status — sync status
  @Get('status')
  async getStatus() {
    return this.zohoService.getSyncStatus();
  }

  // POST /zoho/sync — trigger manual sync of all pending deals
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async triggerSync() {
    return this.zohoService.syncAllPendingDeals();
  }

  // POST /zoho/refresh-token — refresh Zoho token manually
  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  async refreshToken() {
    const token = await this.zohoService.refreshAccessToken();
    return { success: true, token_refreshed: !!token };
  }
}

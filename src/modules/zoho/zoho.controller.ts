import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ZohoService } from './zoho.service';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { CurrentEmployee } from '../../common/decorators/current-employee.decorator';

@Controller('zoho')
@UseGuards(JwtAuthGuard)
export class ZohoController {
  constructor(private readonly zohoService: ZohoService) {}

  private assertAdmin(employee: any) {
    const role = String(employee?.role || '').toLowerCase();
    if (!role.includes('admin')) {
      throw new ForbiddenException(
        'Access Denied: Only administrators can run this Zoho operation.',
      );
    }
  }

  // GET /zoho/status - sync status
  @Get('status')
  async getStatus() {
    return this.zohoService.getSyncStatus();
  }

  // POST /zoho/pull-initial-sync - Trigger full inbound sync from Zoho Bigin
  @Post('pull-initial-sync')
  @HttpCode(HttpStatus.OK)
  async pullInitialSync(@CurrentEmployee() employee: any) {
    this.assertAdmin(employee);
    return this.zohoService.pullInitialSyncForAdmin();
  }

  // POST /zoho/sync-visit - Push visit to Bigin Contacts module (Image 2)
  @Post('sync-visit')
  @HttpCode(HttpStatus.OK)
  async syncVisit(
    @Body()
    visitData: {
      customer_name: string;
      person_met?: string;
      contact_no?: string;
      remarks?: string;
      salesperson_name?: string;
      salesperson_phone?: string;
      visited_at?: string;
    },
  ) {
    const contactId = await this.zohoService.syncVisitToBiginContact(visitData);
    return { success: !!contactId, contact_id: contactId };
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
  async wipeBigin(@CurrentEmployee() employee: any) {
    this.assertAdmin(employee);
    return this.zohoService.wipeAllBiginData();
  }

  // POST /zoho/resync - full clean re-sync of all data
  @Post('resync')
  @HttpCode(HttpStatus.OK)
  async fullResync(@CurrentEmployee() employee: any) {
    this.assertAdmin(employee);
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

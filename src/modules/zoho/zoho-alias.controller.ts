import { Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ZohoService } from './zoho.service';

@Controller()
export class ZohoAliasController {
  constructor(private readonly zohoService: ZohoService) {}

  @Get('bigin-sync')
  @Post('bigin-sync')
  @HttpCode(HttpStatus.OK)
  async handleBiginSync() {
    return this.zohoService.pullInitialSyncForAdmin('Alias bigin-sync');
  }

  @Get('bigin-import')
  @Post('bigin-import')
  @HttpCode(HttpStatus.OK)
  async handleBiginImport() {
    return this.zohoService.pullInitialSyncForAdmin('Alias bigin-import');
  }
}

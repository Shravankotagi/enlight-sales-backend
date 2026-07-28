import { Module } from '@nestjs/common';
import { ZohoController } from './zoho.controller';
import { ZohoService } from './zoho.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [SupabaseModule, HttpModule],
  controllers: [ZohoController],
  providers: [ZohoService],
  exports: [ZohoService],
})
export class ZohoModule {}

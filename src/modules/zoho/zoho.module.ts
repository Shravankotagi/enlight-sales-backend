import { Module } from '@nestjs/common';
import { ZohoController } from './zoho.controller';
import { ZohoService } from './zoho.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    SupabaseModule,
    HttpModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'enlight-sales-jwt-secret-2026',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [ZohoController],
  providers: [ZohoService],
  exports: [ZohoService],
})
export class ZohoModule {}

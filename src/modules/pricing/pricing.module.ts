import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { UnitConverterService } from './unit-converter.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    HttpModule,
    SupabaseModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'enlight-sales-jwt-secret-2026',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [PricingController],
  providers: [PricingService, UnitConverterService],
  exports: [PricingService, UnitConverterService],
})
export class PricingModule {}

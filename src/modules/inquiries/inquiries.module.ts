import { Module } from '@nestjs/common';
import { InquiriesController } from './inquiries.controller';
import { InquiriesService } from './inquiries.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { JwtModule } from '@nestjs/jwt';
import { DealsModule } from '../deals/deals.module';

@Module({
  imports: [
    SupabaseModule,
    DealsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'enlight-sales-jwt-secret-2026',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [InquiriesController],
  providers: [InquiriesService],
  exports: [InquiriesService],
})
export class InquiriesModule {}

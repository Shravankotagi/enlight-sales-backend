import { Module } from '@nestjs/common';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    SupabaseModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'enlight-sales-jwt-secret-2026',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}

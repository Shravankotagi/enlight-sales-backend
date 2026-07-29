import { Module } from '@nestjs/common';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [SupabaseModule, JwtModule],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}

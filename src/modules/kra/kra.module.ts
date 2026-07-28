import { Module } from '@nestjs/common';
import { KraController } from './kra.controller';
import { KraService } from './kra.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [KraController],
  providers: [KraService],
  exports: [KraService],
})
export class KraModule {}

import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { SupabaseHealthIndicator } from './indicators/prisma.health';
import { HealthController } from './health.controller';
import { SupabaseModule } from 'src/infrastructure/supabase/supabase.module';

@Module({
  imports: [TerminusModule, HttpModule, SupabaseModule],
  controllers: [HealthController],
  providers: [SupabaseHealthIndicator],
})
export class HealthModule {}

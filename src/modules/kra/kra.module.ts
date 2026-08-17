import { Module } from '@nestjs/common';
import { KraController } from './kra.controller';
import { KraService } from './kra.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { EmployeesModule } from '../employees/employees.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    SupabaseModule,
    EmployeesModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'enlight-sales-jwt-secret-2026',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [KraController],
  providers: [KraService],
  exports: [KraService],
})
export class KraModule {}

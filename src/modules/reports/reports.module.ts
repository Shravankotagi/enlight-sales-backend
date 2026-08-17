import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
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
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}

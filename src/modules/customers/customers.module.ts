import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerInsightsService } from './customer-insights.service';
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
  controllers: [CustomersController],
  providers: [CustomersService, CustomerInsightsService],
  exports: [CustomersService, CustomerInsightsService],
})
export class CustomersModule {}

import { Module } from '@nestjs/common';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { EmployeesModule } from '../employees/employees.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    SupabaseModule,
    EmployeesModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'enlight-sales-secret-2026',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [OtpController],
  providers: [OtpService],
  exports: [OtpService],
})
export class OtpModule {}

import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { SupabaseModule } from './infrastructure/supabase/supabase.module';
import { UsersModule } from './modules/users/users.module';
import { AdminsModule } from './modules/admins/admins.module';
import { PlansModule } from './modules/plans/plans.module';
import { ProfessionsModule } from './modules/professions/professions.module';
import { ConfigModule } from './config/config.module';
import { AuthModule } from './modules/auth/auth.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { InterestsModule } from './modules/interests/interests.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { HealthModule } from './health/health.module';
import { DealsModule } from './modules/deals/deals.module';
import { InquiriesModule } from './modules/inquiries/inquiries.module';
import { CustomersModule } from './modules/customers/customers.module';
import { KraModule } from './modules/kra/kra.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ZohoModule } from './modules/zoho/zoho.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { OtpModule } from './modules/otp/otp.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';
import { ActivityLogsModule } from './modules/activity-logs/activity-logs.module';

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    PrismaModule,
    SupabaseModule,
    AuthModule,
    UsersModule,
    AdminsModule,
    PlansModule,
    ProfessionsModule,
    CompaniesModule,
    InterestsModule,
    AddressesModule,
    HealthModule,
    DealsModule,
    InquiriesModule,
    CustomersModule,
    KraModule,
    ReportsModule,
    ZohoModule,
    EmployeesModule,
    OtpModule,
    PricingModule,
    ChatbotModule,
    ActivityLogsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

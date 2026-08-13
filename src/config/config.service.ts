import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

@Injectable()
export class ConfigService {
  constructor(private configService: NestConfigService) {}

  get port(): number {
    return this.configService.get<number>('port');
  }

  get supabaseUrl(): string {
    return (
      this.configService.get<string>('supabase.url') ||
      process.env.SUPABASE_URL ||
      'https://dzjqheusezwkhjmpnjsr.supabase.co'
    );
  }

  get supabaseKey(): string {
    return (
      this.configService.get<string>('supabase.key') ||
      process.env.SUPABASE_KEY ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6anFoZXVzZXp3a2hqbXBuanNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MzY0NjIsImV4cCI6MjEwMDIxMjQ2Mn0.WXK8mx4NJlsWlkqIGkDQZHK3QUASjhrqwNXcfB_f0E8'
    );
  }

  get supabaseServiceKey(): string {
    return (
      process.env.SUPABASE_SERVICE_KEY ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6anFoZXVzZXp3a2hqbXBuanNyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDYzNjQ2MiwiZXhwIjoyMTAwMjEyNDYyfQ.rSnHhXgOM6XuC1HCSPqlWodagwur71vdZWbZtVgz9aE'
    );
  }

  get superAdminEmail(): string {
    return (
      this.configService.get<string>('admin.superAdminEmail') ||
      'your_email@example.com'
    );
  }

  get superAdminPassword(): string {
    return (
      this.configService.get<string>('admin.superAdminPassword') ||
      'password123'
    );
  }

  get databaseUrl(): string {
    return this.configService.get<string>('database.url');
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

@Injectable()
export class ConfigService {
  constructor(private configService: NestConfigService) {}

  get port(): number {
    return this.configService.get<number>('port');
  }

  get supabaseUrl(): string {
    const url =
      this.configService.get<string>('supabase.url') ||
      process.env.SUPABASE_URL;
    if (!url) {
      throw new Error('Missing SUPABASE_URL in configuration or environment');
    }
    return url;
  }

  get supabaseKey(): string {
    const key =
      this.configService.get<string>('supabase.key') ||
      process.env.SUPABASE_KEY;
    if (!key) {
      throw new Error('Missing SUPABASE_KEY in configuration or environment');
    }
    return key;
  }

  get supabaseServiceKey(): string {
    const serviceKey =
      this.configService.get<string>('supabase.serviceKey') ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      throw new Error(
        'Missing SUPABASE_SERVICE_KEY in configuration or environment',
      );
    }
    return serviceKey;
  }

  get superAdminEmail(): string {
    return (
      this.configService.get<string>('admin.superAdminEmail') ||
      process.env.SUPER_ADMIN_EMAIL ||
      ''
    );
  }

  get superAdminPassword(): string {
    return (
      this.configService.get<string>('admin.superAdminPassword') ||
      process.env.SUPER_ADMIN_PASSWORD ||
      ''
    );
  }

  get databaseUrl(): string {
    return this.configService.get<string>('database.url');
  }
}

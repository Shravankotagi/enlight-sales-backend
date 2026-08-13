import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super();
  }

  async onModuleInit() {
    try {
      await this.$connect();
      console.log('[PrismaService] Connected to PostgreSQL database');
    } catch (err: any) {
      console.warn('[PrismaService] Database connect notice (non-fatal):', err?.message || err);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

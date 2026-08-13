import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super();
    this.$connect()
      .then(() => console.log('[PrismaService] Connected to PostgreSQL'))
      .catch((err: any) =>
        console.warn(
          '[PrismaService] Connection notice (non-fatal):',
          err?.message || err,
        ),
      );
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

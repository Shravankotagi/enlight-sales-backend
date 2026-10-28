import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { ZohoBooksClient } from './zoho-books.client';
import { DispatchDocumentExtractor } from './dispatch-document.extractor';

@Module({
  imports: [SupabaseModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, ZohoBooksClient, DispatchDocumentExtractor],
  exports: [InvoicesService],
})
export class InvoicesModule {}

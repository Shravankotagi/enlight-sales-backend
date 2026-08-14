import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { ToolRegistryService } from './tools/tool-registry.service';
import { KbService } from './kb/kb.service';
import { KbController } from './kb/kb.controller';

@Module({
  imports: [SupabaseModule],
  controllers: [ChatbotController, KbController],
  providers: [ChatbotService, ToolRegistryService, KbService],
  exports: [ChatbotService, ToolRegistryService, KbService],
})
export class ChatbotModule {}

import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { ConfigModule } from '../../config/config.module';
import { ToolRegistryService } from './tools/tool-registry.service';
import { KbService } from './kb/kb.service';
import { KbController } from './kb/kb.controller';
import { GuardrailsService } from './guardrails/guardrails.service';

@Module({
  imports: [SupabaseModule, ConfigModule],
  controllers: [ChatbotController, KbController],
  providers: [
    ChatbotService,
    ToolRegistryService,
    KbService,
    GuardrailsService,
  ],
  exports: [ChatbotService, ToolRegistryService, KbService, GuardrailsService],
})
export class ChatbotModule {}

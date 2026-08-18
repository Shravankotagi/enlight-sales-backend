import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { ConfigModule } from '../../config/config.module';
import { ToolRegistryService } from './tools/tool-registry.service';
import { KbService } from './kb/kb.service';
import { KbController } from './kb/kb.controller';
import { GuardrailsService } from './guardrails/guardrails.service';
import { WhatsAppChatService } from './whatsapp/whatsapp-chat.service';

import { WhatsAppChatController } from './whatsapp/whatsapp-chat.controller';

@Module({
  imports: [SupabaseModule, ConfigModule],
  controllers: [ChatbotController, KbController, WhatsAppChatController],
  providers: [
    ChatbotService,
    ToolRegistryService,
    KbService,
    GuardrailsService,
    WhatsAppChatService,
  ],
  exports: [
    ChatbotService,
    ToolRegistryService,
    KbService,
    GuardrailsService,
    WhatsAppChatService,
  ],
})
export class ChatbotModule {}

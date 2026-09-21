import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { ConfigModule } from '../../config/config.module';
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
    KbService,
    GuardrailsService,
    WhatsAppChatService,
  ],
  exports: [ChatbotService, KbService, GuardrailsService, WhatsAppChatService],
})
export class ChatbotModule {}

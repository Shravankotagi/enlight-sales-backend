import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { ChatbotService } from '../chatbot.service';
import { CallerContext } from '../tools/chatbot-tool.interface';

export interface WhatsAppMessageResult {
  success: boolean;
  reply: string;
  sessionId?: string;
  caller?: {
    name: string;
    role: string;
    employeeId: string;
  };
  requiresVerification?: boolean;
}

@Injectable()
export class WhatsAppChatService {
  private readonly logger = new Logger(WhatsAppChatService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly chatbotService: ChatbotService,
  ) {}

  private get supabaseAdmin() {
    return this.supabaseService.getAdminClient();
  }

  /**
   * Normalizes phone numbers to 10-digit standard or E.164.
   */
  normalizePhoneNumber(phone: string): {
    raw: string;
    last10: string;
    fullWithCountry: string;
  } {
    const digits = (phone || '').replace(/\D/g, '');
    const last10 = digits.slice(-10);
    const fullWithCountry = digits.length > 10 ? digits : `91${last10}`;
    return {
      raw: phone,
      last10,
      fullWithCountry,
    };
  }

  /**
   * Resolves WhatsApp sender phone to an authenticated CallerContext.
   * Fail-Closed: If number is unregistered or unverified, access is strictly denied.
   */
  async resolveWhatsAppCaller(senderPhone: string): Promise<{
    caller: CallerContext | null;
    isRegistered: boolean;
    isVerified: boolean;
    employeeRecord: any | null;
  }> {
    const { last10, fullWithCountry } = this.normalizePhoneNumber(senderPhone);
    if (!last10 || last10.length < 10) {
      return {
        caller: null,
        isRegistered: false,
        isVerified: false,
        employeeRecord: null,
      };
    }

    try {
      // 1. Search employees table matching phone number
      const { data: employees, error } = await this.supabaseAdmin
        .from('employees')
        .select('*')
        .or(`phone.ilike.%${last10}%,phone.eq.${fullWithCountry}`)
        .limit(1);

      if (error) {
        this.logger.error(
          `Error querying employee for WhatsApp phone ${senderPhone}:`,
          error,
        );
        return {
          caller: null,
          isRegistered: false,
          isVerified: false,
          employeeRecord: null,
        };
      }

      const emp = employees && employees.length > 0 ? employees[0] : null;
      if (!emp) {
        this.logger.warn(`Unregistered WhatsApp sender phone: ${senderPhone}`);
        return {
          caller: null,
          isRegistered: false,
          isVerified: false,
          employeeRecord: null,
        };
      }

      // 2. Check WhatsApp verification status
      // If whatsapp_verified_at is null, allow verification if OTP was completed or flag unverified
      const isVerified = Boolean(
        emp.whatsapp_verified_at || emp.is_active !== false,
      );

      const allIds = [emp.id, emp.employee_id, emp.phone];
      if (emp.phone) {
        const pNorm = this.normalizePhoneNumber(emp.phone);
        if (!allIds.includes(pNorm.last10)) allIds.push(pNorm.last10);
        if (!allIds.includes(pNorm.fullWithCountry))
          allIds.push(pNorm.fullWithCountry);
      }

      const rawRole = (emp.role || '').toLowerCase();
      let role: 'salesperson' | 'manager' | 'admin' = 'salesperson';
      if (rawRole.includes('admin')) {
        role = 'admin';
      } else if (rawRole.includes('manager')) {
        role = 'manager';
      } else {
        role = 'salesperson';
      }

      const caller: CallerContext = {
        userId: emp.id,
        email: emp.email || `${emp.employee_id}@enlightmetals.com`,
        role: role,
        employeeId: emp.employee_id,
        phone: emp.phone || fullWithCountry,
        reportsToId: emp.reports_to_employee_id || undefined,
        name: emp.name || 'Sales Staff',
        allUserIds: allIds,
      };

      return {
        caller,
        isRegistered: true,
        isVerified,
        employeeRecord: emp,
      };
    } catch (err: any) {
      this.logger.error(`Failed to resolve WhatsApp caller: ${err.message}`);
      return {
        caller: null,
        isRegistered: false,
        isVerified: false,
        employeeRecord: null,
      };
    }
  }

  /**
   * Resolves or creates a 24-hour session window for WhatsApp conversations.
   */
  async getOrCreateWhatsAppSession(
    caller: CallerContext,
    senderPhone: string,
  ): Promise<any> {
    const { fullWithCountry } = this.normalizePhoneNumber(senderPhone);
    const windowMs = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();

    // Look for existing active whatsapp session
    const { data: sessions } = await this.supabaseAdmin
      .from('chat_sessions')
      .select('*')
      .eq('channel', 'whatsapp')
      .in('user_id', caller.allUserIds || [caller.userId])
      .order('last_active_at', { ascending: false })
      .limit(1);

    if (sessions && sessions.length > 0) {
      const latest = sessions[0];
      const lastActive = new Date(latest.last_active_at).getTime();
      if (now - lastActive < windowMs) {
        // Within 24-hour free-form session window
        return latest;
      }
    }

    // Outside 24h window or first-time -> create new WhatsApp session
    const { data: newSession, error } = await this.supabaseAdmin
      .from('chat_sessions')
      .insert({
        user_id: caller.userId,
        channel: 'whatsapp',
        external_thread_id: fullWithCountry,
        started_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !newSession) {
      this.logger.error('Error creating WhatsApp chat session:', error);
      throw new Error('Failed to create WhatsApp chat session');
    }

    return newSession;
  }

  /**
   * Main entrypoint for processing incoming WhatsApp conversational messages.
   * Routes normalized messages through the exact same orchestrator, guardrails, and tools.
   */
  async handleIncomingWhatsAppMessage(
    senderPhone: string,
    messageText: string,
  ): Promise<WhatsAppMessageResult> {
    this.logger.log(
      `Processing WhatsApp chat message from ${senderPhone}: "${messageText.slice(0, 60)}"`,
    );

    // 1. Resolve caller context (Fail-Closed)
    const { caller, isRegistered, isVerified } =
      await this.resolveWhatsAppCaller(senderPhone);

    if (!isRegistered || !caller) {
      // Audit log unverified attempt
      await this.supabaseAdmin.from('audit_log').insert({
        user_id: 'unregistered_whatsapp',
        tool_name: 'whatsapp_unregistered_block',
        args: { phone: senderPhone },
        row_count: 0,
        details: { error: 'Unregistered phone number' },
        created_at: new Date().toISOString(),
      });

      return {
        success: false,
        requiresVerification: true,
        reply:
          '🔒 *Enlight Sales OS Assistant*\n\nYour phone number is not registered in our system. Please contact your system administrator to register your phone number for Enlight Metals Sales OS.',
      };
    }

    if (!isVerified) {
      return {
        success: false,
        requiresVerification: true,
        reply: `🔒 *Verification Required*\n\nHello ${caller.name}, your account (${caller.employeeId}) requires WhatsApp verification. Please request an OTP from your administrator or verify your number in the Web Dashboard.`,
      };
    }

    // 2. Resolve 24-hour Session Window
    const session = await this.getOrCreateWhatsAppSession(caller, senderPhone);

    // 3. Process via unified ChatbotService orchestrator (Shared Gemini, Guardrails & 7 RBAC Tools)
    const result = await this.chatbotService.processChatMessage(
      caller,
      messageText,
      session.id,
    );

    // 4. Format reply for WhatsApp
    const formattedReply = this.formatForWhatsApp(result.reply);

    return {
      success: true,
      sessionId: result.sessionId,
      reply: formattedReply,
      caller: {
        name: caller.name,
        role: caller.role,
        employeeId: caller.employeeId,
      },
    };
  }

  /**
   * Formats Markdown text into clean WhatsApp markup (*bold*, _italic_, citations).
   */
  formatForWhatsApp(text: string): string {
    if (!text) return '';
    let out = text;

    // Convert Markdown bold **text** to WhatsApp *text*
    out = out.replace(/\*\*([^*]+)\*\*/g, '*$1*');

    // Convert citation tags [Source: Document] to WhatsApp formatted citation
    out = out.replace(/\[Source:\s*([^\]]+)\]/g, '\n📄 _Source: $1_');

    // Ensure list formatting is clean
    out = out.replace(/^\s*\*\s+/gm, '• ');

    return out.trim();
  }
}

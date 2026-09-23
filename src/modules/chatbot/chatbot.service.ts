import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import axios from 'axios';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { CallerContext } from './interfaces/caller-context.interface';
import { GuardrailsService } from './guardrails/guardrails.service';

export interface ChatMessageResult {
  reply: string;
  sessionId: string;
  interactiveType?: 'buttons' | 'list' | 'text';
  interactiveButtons?: Array<{
    id: string;
    title: string;
    payload?: string;
  }> | null;
  interactiveList?: {
    bodyText?: string;
    buttonText?: string;
    sections?: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
  } | null;
}

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly guardrailsService: GuardrailsService,
  ) {}

  private get supabaseAdmin() {
    return this.supabaseService.getAdminClient();
  }

  /**
   * Resolves caller identity and role from authenticated Supabase user session.
   * Fail-closed: If identity cannot be resolved, throws UnauthorizedException.
   */
  async resolveCallerContext(userOrEmployee: any): Promise<CallerContext> {
    const user = userOrEmployee;
    if (!user || (!user.id && !user.employee_id && !user.phone)) {
      throw new UnauthorizedException(
        'Invalid or missing authentication session',
      );
    }

    const userId = user.id || user.employee_id || user.phone;
    const email = user.email || '';
    const userPhone = user.phone || user.user_metadata?.phone;
    const cleanUserPhone = userPhone
      ? userPhone.replace(/\D/g, '').slice(-10)
      : '';

    try {
      // 1. Check employees table by email, phone, employee_id or id
      const orConditions: string[] = [`id.eq.${userId}`];
      if (email) orConditions.push(`email.ilike.${email}`);
      if (userPhone) orConditions.push(`phone.eq.${userPhone}`);
      if (cleanUserPhone) orConditions.push(`phone.ilike.%${cleanUserPhone}%`);
      if (user.employee_id)
        orConditions.push(`employee_id.eq.${user.employee_id}`);

      const { data: employee } = await this.supabaseAdmin
        .from('employees')
        .select('*')
        .or(orConditions.join(','))
        .eq('is_active', true)
        .limit(1);

      let role: 'salesperson' | 'manager' | 'admin' = 'salesperson';
      let employeeId: string | undefined = user.employee_id;
      let reportsToId: string | undefined;
      let phone: string | undefined =
        userPhone || (cleanUserPhone ? `91${cleanUserPhone}` : undefined);
      let name: string | undefined =
        user.name ||
        user.user_metadata?.full_name ||
        (email ? email.split('@')[0] : undefined);

      if (employee && employee.length > 0) {
        const emp = employee[0];
        employeeId = emp.employee_id || emp.id;
        reportsToId = emp.reports_to_employee_id || undefined;
        phone = emp.phone || phone;
        name = emp.name || name;

        const rawRole = (emp.role || '').toLowerCase();
        if (rawRole.includes('admin')) {
          role = 'admin';
        } else if (rawRole.includes('manager')) {
          role = 'manager';
        } else {
          role = 'salesperson';
        }
      } else if (user.role) {
        const rawUserRole = (user.role || '').toLowerCase();
        if (rawUserRole.includes('admin')) role = 'admin';
        else if (rawUserRole.includes('manager')) role = 'manager';
      } else if (user.user_metadata?.role) {
        const metaRole = (user.user_metadata.role || '').toLowerCase();
        if (metaRole.includes('admin')) role = 'admin';
        else if (metaRole.includes('manager')) role = 'manager';
      }

      const empRecord = employee && employee.length > 0 ? employee[0] : null;
      const allIds = Array.from(
        new Set([
          userId,
          employeeId,
          phone,
          user.id,
          user.employee_id,
          user.phone,
          empRecord?.id,
          empRecord?.employee_id,
          empRecord?.phone,
        ]),
      ).filter(Boolean) as string[];

      return {
        userId,
        email,
        role,
        employeeId,
        phone,
        reportsToId,
        name,
        allUserIds: allIds,
      };
    } catch (err: any) {
      this.logger.error(
        `Error resolving caller context for user ${userId}:`,
        err.message,
      );
      throw new UnauthorizedException('Could not resolve user identity');
    }
  }

  /**
   * Retrieves an existing chat session or creates a new one for the user.
   */
  async getOrCreateSession(
    caller: CallerContext | string,
    channel: string = 'web',
    sessionId?: string,
  ): Promise<any> {
    const isCallerObj = typeof caller !== 'string';
    const userId = isCallerObj ? caller.userId : caller;
    const allowedIds = isCallerObj
      ? caller.allUserIds || [caller.userId]
      : [caller];

    if (sessionId) {
      const { data: existingSession } = await this.supabaseAdmin
        .from('chat_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (existingSession) {
        if (!allowedIds.includes(existingSession.user_id)) {
          throw new ForbiddenException('Access denied to this chat session');
        }
        return existingSession;
      }
    }

    // Create new session
    const { data: newSession, error: createError } = await this.supabaseAdmin
      .from('chat_sessions')
      .insert({
        user_id: userId,
        channel: channel,
        started_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError || !newSession) {
      this.logger.error('Error creating chat session:', createError);
      throw new Error('Failed to create chat session');
    }

    return newSession;
  }

  /**
   * Saves a chat message turn (user, assistant, system, or tool) to chat_messages.
   */
  async saveMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: string,
    functionCall: any = null,
    functionResult: any = null,
  ): Promise<any> {
    const { data, error } = await this.supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role,
        content,
        function_call: functionCall,
        function_result: functionResult,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      this.logger.error(
        `Error saving ${role} message to session ${sessionId}:`,
        error,
      );
    }

    // Update last_active_at on session
    await this.supabaseAdmin
      .from('chat_sessions')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', sessionId);

    return data;
  }

  /**
   * Fetches past conversation turns for a session.
   */
  async getSessionHistory(
    sessionId: string,
    limit: number = 20,
    rolesFilter: string[] = ['user', 'assistant'],
  ): Promise<any[]> {
    const { data, error } = await this.supabaseAdmin
      .from('chat_messages')
      .select('id, role, content, function_result, created_at')
      .eq('session_id', sessionId)
      .in('role', rolesFilter)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error(
        `Error fetching session history for ${sessionId}:`,
        error,
      );
      return [];
    }
    const formatted = (data || []).map((msg: any) => {
      const interactiveMeta = msg.function_result;
      return {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        created_at: msg.created_at,
        interactiveType: interactiveMeta?.interactiveType || 'text',
        interactiveButtons: interactiveMeta?.interactiveButtons || null,
        interactiveList: interactiveMeta?.interactiveList || null,
      };
    });
    return formatted.reverse();
  }

  /**
   * Lists all chat sessions belonging to a specific user.
   */
  async getUserSessions(caller: CallerContext | string): Promise<any[]> {
    const isCallerObj = typeof caller !== 'string';
    const allowedIds = isCallerObj
      ? caller.allUserIds || [caller.userId]
      : [caller];

    let query = this.supabaseAdmin
      .from('chat_sessions')
      .select('*')
      .order('last_active_at', { ascending: false });

    if (allowedIds.length === 1) {
      query = query.eq('user_id', allowedIds[0]);
    } else {
      query = query.in('user_id', allowedIds);
    }

    const { data: sessions, error } = await query;

    if (error) {
      this.logger.error('Error fetching user sessions:', error);
      throw new Error('Failed to fetch user sessions');
    }

    if (!sessions || sessions.length === 0) return [];

    const sessionIds = sessions.map((s) => s.id);
    const { data: firstMsgs } = await this.supabaseAdmin
      .from('chat_messages')
      .select('session_id, content')
      .in('session_id', sessionIds)
      .eq('role', 'user')
      .order('created_at', { ascending: true });

    const titleMap: Record<string, string> = {};
    if (firstMsgs && firstMsgs.length > 0) {
      firstMsgs.forEach((m) => {
        if (!titleMap[m.session_id] && m.content) {
          titleMap[m.session_id] =
            m.content.length > 35
              ? m.content.slice(0, 35).trim() + '...'
              : m.content.trim();
        }
      });
    }

    return sessions.map((s) => ({
      ...s,
      title: titleMap[s.id] || 'New Conversation',
    }));
  }

  /**
   * Retrieves messages for a user's specific session (for reload persistence).
   */
  async getSessionMessages(
    sessionId: string,
    caller: CallerContext | string,
  ): Promise<any[]> {
    const session = await this.getOrCreateSession(caller, 'web', sessionId);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return this.getSessionHistory(sessionId, 50);
  }

  /**
   * Main conversational orchestrator entrypoint.
   * Delegates AI execution directly to the unified WhatsApp/Web AI Engine (em-os-bot).
   */
  async processChatMessage(
    caller: CallerContext,
    messageText: string,
    sessionId?: string,
  ): Promise<ChatMessageResult> {
    this.logger.log(
      `Processing chat message from user ${caller.userId} (${caller.role}): "${messageText.slice(0, 60)}"`,
    );

    // 1. Rate limit check (Security & Guardrail)
    await this.guardrailsService.checkRateLimit(caller.userId);

    // 2. Spend cap check
    if (await this.guardrailsService.isDailySpendCapExceeded()) {
      return {
        reply:
          'Daily AI operations usage cap reached for your organization. High-priority operations remain accessible via Dashboard direct forms.',
        sessionId: sessionId || '',
      };
    }

    // 3. Resolve / Create persistent chat session
    const session = await this.getOrCreateSession(caller, 'web', sessionId);

    // 4. Save user message to chat history
    await this.saveMessage(session.id, 'user', messageText);

    // 5. Input Guardrail Screening
    const screenResult = await this.guardrailsService.screenInput(messageText);
    if (screenResult && !screenResult.safe) {
      const blockedReply =
        screenResult.reason === 'out_of_scope'
          ? 'I am Enlight Metals Sales OS Assistant. I can only assist with B2B metal sales operations, inquiries, orders, customer visits, complaints, and CRM analytics.'
          : 'I cannot process this request as it contains security or policy violation attempts.';
      await this.saveMessage(session.id, 'assistant', blockedReply);
      return {
        reply: blockedReply,
        sessionId: session.id,
      };
    }

    // 6. Forward to Unified AI Engine (em-os-bot)
    const botUrl = process.env.AI_ENGINE_URL || 'http://127.0.0.1:3001';
    const botApiKey =
      process.env.AI_ENGINE_API_KEY ||
      process.env.WEB_CHAT_API_KEY ||
      'enlight_ai_engine_secret_2026_auth_key';

    let assistantReply: string;
    let interactiveType: 'buttons' | 'list' | 'text' = 'text';
    let interactiveButtons: any = null;
    let interactiveList: any = null;

    try {
      const response = await axios.post(
        `${botUrl}/chat/web/message`,
        {
          message: messageText,
          employeePhone: caller.phone || '9619226169',
          userId: caller.userId,
          employeeName: caller.name || 'User',
          role: caller.role,
          resetSession: !sessionId,
        },
        {
          headers: {
            'X-Web-API-Key': botApiKey,
            'Content-Type': 'application/json',
          },
          timeout: 120000,
        },
      );

      const resData = response.data || {};
      assistantReply = resData.reply || 'Your request has been processed.';
      interactiveType = resData.interactiveType || resData.type || 'text';
      interactiveButtons = resData.interactiveButtons || null;
      interactiveList = resData.interactiveList || null;
    } catch (err: any) {
      this.logger.error(
        `AI Engine proxy error (${botUrl}/chat/web/message): ${err.message}`,
        err.response?.data || err.stack,
      );

      if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
        assistantReply =
          'The request took longer than expected. Please try again with a more specific query.';
      } else if (err.code === 'ECONNREFUSED') {
        assistantReply =
          'AI Assistant engine is currently starting up. Please try again in a few seconds.';
      } else {
        assistantReply =
          err.response?.data?.reply ||
          'Sorry, an error occurred while processing your message. Please try again.';
      }
    }

    // 7. Save assistant reply to session history with interactive metadata
    const interactiveMeta =
      interactiveType !== 'text'
        ? { interactiveType, interactiveButtons, interactiveList }
        : null;
    await this.saveMessage(
      session.id,
      'assistant',
      assistantReply,
      null,
      interactiveMeta,
    );

    return {
      reply: assistantReply,
      sessionId: session.id,
      interactiveType,
      interactiveButtons,
      interactiveList,
    };
  }
}

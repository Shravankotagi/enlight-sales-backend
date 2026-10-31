import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { EmployeesService } from '../employees/employees.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import axios from 'axios';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private supabaseService: SupabaseService,
    private employeesService: EmployeesService,
    private jwtService: JwtService,
    private activityLogsService: ActivityLogsService,
  ) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  // Generate 6-digit OTP
  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Send OTP via WhatsApp
  private async sendOtpWhatsApp(phone: string, otp: string): Promise<void> {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      this.logger.error(
        'Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID in env',
      );
      return;
    }

    const clean = phone.replace(/\D/g, '');
    const to = clean.length === 10 ? `91${clean}` : clean;
    const templateName = (
      process.env.WHATSAPP_OTP_TEMPLATE ||
      process.env.WHATSAPP_VISIT_OTP_TEMPLATE ||
      ''
    ).trim();

    const message = ` *Enlight Sigma*\n\nYour OTP is: *${otp}*\n\nValid for 10 minutes. Do not share with anyone.`;

    const getPayload = (useTemplate: boolean) => {
      if (useTemplate && templateName) {
        return {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: 'en' },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: otp }],
              },
            ],
          },
        };
      }
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: message },
      };
    };

    let tryTemplateFirst = Boolean(templateName);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const payload = getPayload(tryTemplateFirst);
        await axios.post(
          `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        );

        this.logger.log(
          `OTP successfully sent to ${to} on WhatsApp via ${tryTemplateFirst ? `template (${templateName})` : 'text'} (attempt ${attempt})`,
        );
        return;
      } catch (error: any) {
        const metaError = error.response?.data || error.message;
        this.logger.error(
          `Failed to send OTP to ${to} (attempt ${attempt}/3, mode: ${tryTemplateFirst ? 'template' : 'text'}): ${JSON.stringify(metaError)}`,
        );
        // If template sending fails, switch to standard text payload for retry
        if (tryTemplateFirst) {
          tryTemplateFirst = false;
        }
        if (attempt === 3) {
          this.logger.log(`[DEV / FALLBACK] OTP for ${to}: ${otp}`);
        } else {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
  }

  private otpRequestTimestamps = new Map<string, number[]>();

  private checkOtpRateLimit(phone: string): void {
    const now = Date.now();
    const windowMs = 2 * 60 * 1000;
    const maxAttempts = 3;

    const timestamps = (this.otpRequestTimestamps.get(phone) || []).filter(
      (ts) => now - ts < windowMs,
    );

    if (timestamps.length >= maxAttempts) {
      throw new BadRequestException(
        'Too many OTP requests. Please wait a minute before requesting another OTP.',
      );
    }

    timestamps.push(now);
    this.otpRequestTimestamps.set(phone, timestamps);
  }

  // Request OTP
  async requestOtp(
    phone: string,
  ): Promise<{ message: string; dev_otp?: string }> {
    try {
      this.checkOtpRateLimit(phone);

      // Check if employee exists
      const employee = await this.employeesService.findByPhone(phone);
      if (!employee) {
        throw new BadRequestException(
          'Phone number not registered. Contact admin.',
        );
      }

      // Generate OTP
      const otp = this.generateOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Invalidate old OTPs for this phone
      await this.supabase
        .from('otp_sessions')
        .update({ verified: true })
        .eq('phone', phone)
        .eq('verified', false);

      // Save new OTP
      const { error: insertErr } = await this.supabase
        .from('otp_sessions')
        .insert({
          phone,
          otp,
          expires_at: expiresAt.toISOString(),
          verified: false,
        });

      if (insertErr) {
        this.logger.error('Failed to insert OTP session:', insertErr);
      }

      // Send via WhatsApp asynchronously in background (non-blocking)
      this.sendOtpWhatsApp(phone, otp).catch((err) =>
        this.logger.error(
          'Background WhatsApp dispatch error:',
          err?.message || err,
        ),
      );

      return {
        message: 'OTP sent to your WhatsApp number',
        dev_otp: otp, // Show OTP on screen for testing purposes
      };
    } catch (error) {
      this.logger.error(`Error in requestOtp for phone ${phone}:`, error);
      throw error;
    }
  }

  // Verify OTP and return JWT
  async verifyOtp(
    phone: string,
    otp: string,
  ): Promise<{
    token: string;
    employee: any;
  }> {
    try {
      // Find valid OTP
      const { data: session, error } = await this.supabase
        .from('otp_sessions')
        .select('*')
        .eq('phone', phone)
        .eq('otp', otp)
        .eq('verified', false)
        .gte('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !session) {
        throw new UnauthorizedException('Invalid or expired OTP');
      }

      // Mark OTP as used
      await this.supabase
        .from('otp_sessions')
        .update({ verified: true })
        .eq('id', session.id);

      // Get employee
      const employee = await this.employeesService.findByPhone(phone);
      if (!employee) {
        throw new UnauthorizedException('Employee not found');
      }

      const sid = randomUUID();
      const payload = {
        phone: employee.phone,
        role: employee.role,
        employee_id: employee.employee_id,
        name: employee.name,
        id: employee.id,
        sid,
      };

      const token = this.jwtService.sign(payload);
      void this.activityLogsService.logActivity({
        module: 'Auth',
        action_type: 'login',
        entity_type: 'session',
        entity_id: sid,
        salesperson_phone: employee.phone,
        salesperson_name: employee.name,
        description: 'Login',
        change_detail: { employee_id: employee.employee_id || null },
      });

      this.logger.log(`Login: ${employee.name} (${employee.role})`);

      return { token, employee };
    } catch (error) {
      this.logger.error(`Error in verifyOtp for phone ${phone}:`, error);
      throw error;
    }
  }

  // Fire-and-forget from the controller. Awaitable so tests can see the row.
  recordLogout(
    token: string | undefined,
    reason: 'manual' | 'session_expired',
  ): Promise<void> {
    return this.writeLogout(token, reason).catch((err: any) => {
      this.logger.warn(`Logout log skipped: ${err?.message}`);
    });
  }

  private async writeLogout(
    token: string | undefined,
    reason: 'manual' | 'session_expired',
  ) {
    if (!token) return;
    let payload: any;
    try {
      payload = this.jwtService.verify(token, { ignoreExpiration: true });
    } catch {
      return;
    }
    const sid = payload?.sid;
    if (!sid) return;

    const { data, error } = await this.supabase
      .from('activity_logs')
      .select('id')
      .eq('entity_id', sid)
      .eq('action_type', 'logout')
      .limit(1);
    if (error) {
      this.logger.warn(`Logout dedupe check failed: ${error.message}`);
    } else if (data && data.length > 0) {
      return;
    }

    const who = [
      payload.name,
      payload.employee_id ? `(${payload.employee_id})` : '',
    ]
      .filter(Boolean)
      .join(' ');
    await this.activityLogsService.logActivity({
      module: 'Auth',
      action_type: 'logout',
      entity_type: 'session',
      entity_id: sid,
      salesperson_phone: payload.phone,
      salesperson_name: payload.name,
      description:
        reason === 'session_expired'
          ? `Session expired. ${who || 'Employee'} logged out.`
          : 'Logout',
      change_detail: {
        reason,
        employee_id: payload.employee_id || null,
      },
    });
  }
}

import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { EmployeesService } from '../employees/employees.service';
import axios from 'axios';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private supabaseService: SupabaseService,
    private employeesService: EmployeesService,
    private jwtService: JwtService,
  ) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  // Generate 6-digit OTP
  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Send OTP via WhatsApp (non-blocking)
  private async sendOtpWhatsApp(phone: string, otp: string): Promise<void> {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      this.logger.error(
        'Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID in env',
      );
      this.logger.log(`[DEV / FALLBACK] OTP for ${phone}: ${otp}`);
      return;
    }

    const message = `🔐 *Enlight Sales OS*\n\nYour OTP is: *${otp}*\n\nValid for 10 minutes. Do not share with anyone.`;

    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phone,
          type: 'text',
          text: { body: message },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        },
      );

      this.logger.log(`OTP successfully sent to ${phone} on WhatsApp`);
    } catch (error: any) {
      const metaError = error.response?.data || error.message;
      this.logger.error(
        `Failed to send WhatsApp OTP to ${phone}: ${JSON.stringify(metaError)}`,
      );
      this.logger.log(`[DEV / FALLBACK] OTP for ${phone}: ${otp}`);
    }
  }

  // Request OTP
  async requestOtp(
    phone: string,
  ): Promise<{ message: string; dev_otp?: string }> {
    try {
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
      await this.supabase.from('otp_sessions').insert({
        phone,
        otp,
        expires_at: expiresAt.toISOString(),
        verified: false,
      });

      // Trigger WhatsApp API in background (non-blocking)
      this.sendOtpWhatsApp(phone, otp).catch((err) => {
        this.logger.error('Background WhatsApp OTP error:', err?.message || err);
      });

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

      // Generate JWT
      const payload = {
        phone: employee.phone,
        role: employee.role,
        employee_id: employee.employee_id,
        name: employee.name,
        id: employee.id,
      };

      const token = this.jwtService.sign(payload);

      this.logger.log(`Login: ${employee.name} (${employee.role})`);

      return { token, employee };
    } catch (error) {
      this.logger.error(`Error in verifyOtp for phone ${phone}:`, error);
      throw error;
    }
  }
}

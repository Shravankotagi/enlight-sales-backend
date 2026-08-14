import {
  Controller,
  Post,
  Options,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OtpService } from './otp.service';

@Controller('auth')
export class OtpController {
  constructor(private readonly otpService: OtpService) {}

  @Options('request-otp')
  @HttpCode(HttpStatus.OK)
  optionsRequestOtp() {
    return;
  }

  // POST /auth/request-otp
  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  async requestOtp(@Body() body: { phone: string }) {
    return this.otpService.requestOtp(body.phone);
  }

  @Options('verify-otp')
  @HttpCode(HttpStatus.OK)
  optionsVerifyOtp() {
    return;
  }

  // POST /auth/verify-otp
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() body: { phone: string; otp: string }) {
    return this.otpService.verifyOtp(body.phone, body.otp);
  }
}

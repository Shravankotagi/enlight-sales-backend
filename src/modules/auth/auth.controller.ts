import {
  Controller,
  Get,
  Post,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SupabaseGuard } from '../../common/guards/supabase.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @ApiOperation({ summary: 'Register a new user (Disabled)' })
  async signUp() {
    throw new ForbiddenException(
      'Public email registration is disabled. Please log in using WhatsApp OTP authentication.',
    );
  }

  @Post('signin')
  @ApiOperation({ summary: 'Login user (Disabled)' })
  async signIn() {
    throw new ForbiddenException(
      'Email password login is disabled. Please log in using WhatsApp OTP authentication.',
    );
  }

  @Post('signout')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({
    status: 200,
    description: 'User successfully logged out',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async signOut(@Request() req) {
    return this.authService.signOut(req.user.token);
  }

  @Get('me')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({
    status: 200,
    description: 'Returns the current user profile',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async getProfile(@Request() req) {
    return this.authService.getUser(req.user.token);
  }
}

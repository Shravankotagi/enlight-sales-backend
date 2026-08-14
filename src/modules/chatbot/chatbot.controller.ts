import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt.guard';
import { ChatbotService } from './chatbot.service';
import { SendChatMessageDto } from './dto/chat.dto';

@ApiTags('chat')
@Controller('chat')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post('message')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a message to the Enlight Sales OS Conversational Assistant',
  })
  @ApiResponse({
    status: 200,
    description: 'Message processed successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  async sendMessage(@Request() req: any, @Body() dto: SendChatMessageDto) {
    // 1. Resolve identity & role (fail closed)
    const caller = await this.chatbotService.resolveCallerContext(
      req.employee || req.user,
    );

    // 2. Process message & generate response
    const result = await this.chatbotService.processChatMessage(
      caller,
      dto.message,
      dto.sessionId,
    );

    return {
      success: true,
      sessionId: result.sessionId,
      reply: result.reply,
      caller: {
        role: caller.role,
        name: caller.name,
      },
    };
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Get all chat sessions for the authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'List of chat sessions',
  })
  async getSessions(@Request() req: any) {
    const caller = await this.chatbotService.resolveCallerContext(
      req.employee || req.user,
    );
    const sessions = await this.chatbotService.getUserSessions(caller.userId);
    return {
      success: true,
      sessions,
    };
  }

  @Get('sessions/:sessionId/messages')
  @ApiOperation({ summary: 'Get message history for a specific chat session' })
  @ApiResponse({
    status: 200,
    description: 'List of messages in the chat session',
  })
  @ApiResponse({
    status: 404,
    description: 'Session not found',
  })
  async getSessionMessages(
    @Request() req: any,
    @Param('sessionId') sessionId: string,
  ) {
    const caller = await this.chatbotService.resolveCallerContext(
      req.employee || req.user,
    );
    const messages = await this.chatbotService.getSessionMessages(
      sessionId,
      caller.userId,
    );
    return {
      success: true,
      sessionId,
      messages,
    };
  }
}

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { WhatsAppChatService } from './whatsapp-chat.service';

export class WhatsAppMessageDto {
  @ApiProperty({
    description: 'The WhatsApp phone number of the sender',
    example: '919619226169',
  })
  @IsString()
  @IsNotEmpty()
  senderPhone: string;

  @ApiProperty({
    description: 'The incoming WhatsApp message text',
    example: 'Show my open deals',
  })
  @IsString()
  @IsNotEmpty()
  messageText: string;

  @ApiPropertyOptional({ description: 'Optional media URL' })
  @IsOptional()
  @IsString()
  mediaUrl?: string;
}

@ApiTags('chat-whatsapp')
@Controller('chat/whatsapp')
export class WhatsAppChatController {
  private readonly logger = new Logger(WhatsAppChatController.name);

  constructor(private readonly whatsappChatService: WhatsAppChatService) {}

  @Post('message')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Process incoming WhatsApp message through unified AI assistant',
  })
  @ApiResponse({
    status: 200,
    description: 'Message processed and formatted for WhatsApp delivery',
  })
  async handleMessage(@Body() dto: WhatsAppMessageDto) {
    if (!dto.senderPhone || !dto.messageText) {
      throw new BadRequestException('senderPhone and messageText are required');
    }

    return this.whatsappChatService.handleIncomingWhatsAppMessage(
      dto.senderPhone,
      dto.messageText,
    );
  }
}

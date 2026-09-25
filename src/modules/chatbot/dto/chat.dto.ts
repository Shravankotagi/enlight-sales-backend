import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendChatMessageDto {
  @ApiProperty({
    description: 'The user message text',
    example: 'Hello! Can you help me check my deals?',
  })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({
    description:
      'Optional chat session ID. If omitted, a new chat session will be created automatically.',
    example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
  })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({
    description: 'Optional base64 image data with MIME type',
    example: { base64: 'data:image/jpeg;base64,...', mimeType: 'image/jpeg' },
  })
  @IsOptional()
  image?: {
    base64: string;
    mimeType: string;
  };

  @ApiPropertyOptional({
    description: 'Optional GPS coordinates captured from browser geolocation',
    example: { latitude: 18.5204, longitude: 73.8567, accuracy: 15 },
  })
  @IsOptional()
  gps?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  };
}

export class ChatSessionResponseDto {
  id: string;
  user_id: string;
  channel: string;
  started_at: string;
  last_active_at: string;
}

export class ChatMessageResponseDto {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  created_at: string;
}

import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { SupabaseGuard } from '../../../common/guards/supabase.guard';
import { KbService, IngestDocumentDto } from './kb.service';
import { ChatbotService } from '../chatbot.service';

@Controller('chat/kb')
@UseGuards(SupabaseGuard)
export class KbController {
  constructor(
    private readonly kbService: KbService,
    private readonly chatbotService: ChatbotService,
  ) {}

  /**
   * Upload and ingest document into Knowledge Base.
   * Admin only.
   */
  @Post('upload')
  async uploadDocument(@Req() req: any, @Body() body: any) {
    const caller = await this.chatbotService.resolveCallerContext(req.user);
    if (caller.role !== 'admin') {
      throw new ForbiddenException(
        'Only system administrators can upload Knowledge Base documents.',
      );
    }

    const dto: IngestDocumentDto = {
      title: body.title,
      content: body.content,
      visibilityRole: body.visibilityRole || body.visibility_role || 'all',
      uploadedBy: caller.userId,
      sourceFileUrl: body.sourceFileUrl || body.source_file_url,
    };

    return this.kbService.ingestDocument(dto);
  }

  /**
   * List Knowledge Base documents.
   */
  @Get('documents')
  async listDocuments(@Req() req: any) {
    await this.chatbotService.resolveCallerContext(req.user);
    return this.kbService.listDocuments();
  }

  /**
   * Delete a Knowledge Base document by ID.
   * Admin only.
   */
  @Delete('documents/:id')
  async deleteDocument(@Req() req: any, @Param('id') id: string) {
    const caller = await this.chatbotService.resolveCallerContext(req.user);
    if (caller.role !== 'admin') {
      throw new ForbiddenException(
        'Only system administrators can delete Knowledge Base documents.',
      );
    }
    const success = await this.kbService.deleteDocument(id);
    return { success, id };
  }
}

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
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt.guard';
import { KbService, IngestDocumentDto } from './kb.service';
import { ChatbotService } from '../chatbot.service';

const ALLOWED_KB_EXTENSIONS = [
  '.pdf',
  '.txt',
  '.md',
  '.markdown',
  '.text',
  '.json',
  '.csv',
];

@Controller('chat/kb')
@UseGuards(JwtAuthGuard)
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
    const caller = await this.chatbotService.resolveCallerContext(
      req.employee || req.user,
    );
    if (caller.role !== 'admin') {
      throw new ForbiddenException(
        'Only system administrators can upload Knowledge Base documents.',
      );
    }

    if (!body?.title?.trim() || !body?.content?.trim()) {
      throw new BadRequestException('Document title and content are required.');
    }

    const sourceFile = body.sourceFileUrl || body.source_file_url;
    if (sourceFile) {
      const extIndex = sourceFile.lastIndexOf('.');
      const ext =
        extIndex !== -1 ? sourceFile.slice(extIndex).toLowerCase() : '';
      if (ext && !ALLOWED_KB_EXTENSIONS.includes(ext)) {
        throw new BadRequestException(
          `Unsupported file format "${sourceFile}". Supported formats are: .pdf, .txt, .md, .csv, .json.`,
        );
      }
    }

    const dto: IngestDocumentDto = {
      title: body.title.trim(),
      content: body.content.trim(),
      visibilityRole: body.visibilityRole || body.visibility_role || 'all',
      uploadedBy: caller.userId,
      sourceFileUrl: sourceFile,
    };

    return this.kbService.ingestDocument(dto);
  }

  /**
   * List Knowledge Base documents.
   */
  @Get('documents')
  async listDocuments(@Req() req: any) {
    await this.chatbotService.resolveCallerContext(req.employee || req.user);
    return this.kbService.listDocuments();
  }

  /**
   * Delete a Knowledge Base document by ID.
   * Admin only.
   */
  @Delete('documents/:id')
  async deleteDocument(@Req() req: any, @Param('id') id: string) {
    const caller = await this.chatbotService.resolveCallerContext(
      req.employee || req.user,
    );
    if (caller.role !== 'admin') {
      throw new ForbiddenException(
        'Only system administrators can delete Knowledge Base documents.',
      );
    }
    const success = await this.kbService.deleteDocument(id);
    return { success, id };
  }

  /**
   * Extracts text content from a base64 encoded document/PDF.
   * Accessible to Admin and Manager roles.
   */
  @Post('extract-text')
  async extractText(@Req() req: any, @Body() body: any) {
    const caller = await this.chatbotService.resolveCallerContext(
      req.employee || req.user,
    );
    if (caller.role !== 'admin' && caller.role !== 'manager') {
      throw new ForbiddenException(
        'You must have manager or admin privileges to extract and upload documents.',
      );
    }

    if (!body?.fileBase64) {
      throw new BadRequestException('fileBase64 is required.');
    }

    if (body?.fileName) {
      const extIndex = body.fileName.lastIndexOf('.');
      const ext =
        extIndex !== -1 ? body.fileName.slice(extIndex).toLowerCase() : '';
      if (ext && ext !== '.pdf') {
        throw new BadRequestException(
          `Unsupported file format "${body.fileName}". Only PDF (.pdf) documents are supported for automated text extraction.`,
        );
      }
    }

    return this.kbService.extractTextFromPdf(body.fileBase64, body.fileName);
  }
}

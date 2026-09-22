import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';

export interface IngestDocumentDto {
  title: string;
  content: string;
  visibilityRole:
    'all' | 'salesperson' | 'manager' | 'manager_plus' | 'admin' | 'admin_only';
  uploadedBy: string;
  sourceFileUrl?: string;
}

@Injectable()
export class KbService {
  private readonly logger = new Logger(KbService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private get supabaseAdmin() {
    return this.supabaseService.getAdminClient();
  }

  /**
   * Generates a 768-dimension vector embedding using gemini-embedding-001 with outputDimensionality: 768.
   */
  async generateEmbedding(
    text: string,
    taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT',
  ): Promise<number[]> {
    const apiKey =
      process.env.GEMINI_PAID_API_KEY || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error('Gemini API key is missing');
    }

    const modelName =
      process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });

      const response: any = await ai.models.embedContent({
        model: modelName,
        contents: text,
        config: {
          taskType: taskType,
          outputDimensionality: 768,
        },
      });

      let values =
        response?.embedding?.values || response?.embeddings?.[0]?.values;
      if (values && values.length > 0) {
        // Slice to 768 if needed
        if (values.length > 768) {
          values = values.slice(0, 768);
        }
        return values;
      }

      throw new Error('No embedding values returned from Gemini API');
    } catch (err: any) {
      this.logger.warn(
        `Primary GoogleGenAI embed failed: ${err.message}. Trying LangChain embedding fallback.`,
      );

      try {
        const { GoogleGenerativeAIEmbeddings } =
          await import('@langchain/google-genai');
        const embeddings = new GoogleGenerativeAIEmbeddings({
          model: modelName,
          apiKey: apiKey,
        });

        const raw = await embeddings.embedQuery(text);
        return raw.length > 768 ? raw.slice(0, 768) : raw;
      } catch (fallbackErr: any) {
        this.logger.error(
          'Embedding generation failed on all fallbacks:',
          fallbackErr,
        );
        throw new Error(
          `Failed to generate text embedding: ${fallbackErr.message}`,
        );
      }
    }
  }

  /**
   * Chunks text content into ~500-800 token slices (~2000-3000 chars) with 50-token overlap.
   */
  chunkText(
    text: string,
    targetChunkLength: number = 2200,
    overlapLength: number = 200,
  ): string[] {
    const cleanText = text.replace(/\r\n/g, '\n').trim();
    if (cleanText.length <= targetChunkLength) {
      return [cleanText];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < cleanText.length) {
      let end = start + targetChunkLength;

      if (end >= cleanText.length) {
        chunks.push(cleanText.substring(start));
        break;
      }

      // Find nearest natural sentence / paragraph break
      const breakIdx = cleanText.lastIndexOf('\n', end);
      if (breakIdx > start + targetChunkLength * 0.5) {
        end = breakIdx + 1;
      } else {
        const periodIdx = cleanText.lastIndexOf('. ', end);
        if (periodIdx > start + targetChunkLength * 0.5) {
          end = periodIdx + 2;
        }
      }

      const chunk = cleanText.substring(start, end).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }

      start = end - overlapLength;
    }

    return chunks;
  }

  /**
   * Ingests a new document: creates kb_documents record, chunks text, embeds chunks, and saves to kb_chunks.
   */
  async ingestDocument(dto: IngestDocumentDto): Promise<any> {
    if (!dto.title || !dto.content) {
      throw new BadRequestException('Document title and content are required');
    }

    this.logger.log(
      `Starting KB ingestion for document '${dto.title}' (visibility: ${dto.visibilityRole})`,
    );

    // 1. Create kb_documents record
    const { data: doc, error: docErr } = await this.supabaseAdmin
      .from('kb_documents')
      .insert({
        title: dto.title.trim(),
        source_file_url: dto.sourceFileUrl || null,
        visibility_role: dto.visibilityRole || 'all',
        uploaded_by: dto.uploadedBy,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (docErr || !doc) {
      this.logger.error('Error creating kb_documents record:', docErr);
      throw new Error(`Failed to save document metadata: ${docErr?.message}`);
    }

    // 2. Chunk document text
    const textChunks = this.chunkText(dto.content);
    this.logger.log(
      `Document '${dto.title}' split into ${textChunks.length} chunks.`,
    );

    // 3. Generate embeddings and save chunks
    const chunkRecords: any[] = [];
    for (let i = 0; i < textChunks.length; i++) {
      const chunkTextContent = textChunks[i];
      const embedding = await this.generateEmbedding(
        chunkTextContent,
        'RETRIEVAL_DOCUMENT',
      );

      chunkRecords.push({
        doc_id: doc.id,
        content: chunkTextContent,
        embedding: JSON.stringify(embedding),
        token_count: Math.round(chunkTextContent.length / 4),
        metadata: {
          title: dto.title,
          chunk_index: i,
          total_chunks: textChunks.length,
          visibility_role: dto.visibilityRole,
        },
        created_at: new Date().toISOString(),
      });
    }

    const { data: insertedChunks, error: chunkErr } = await this.supabaseAdmin
      .from('kb_chunks')
      .insert(chunkRecords)
      .select('id');

    if (chunkErr) {
      this.logger.error('Error inserting kb_chunks:', chunkErr);
      throw new Error(`Failed to insert document chunks: ${chunkErr.message}`);
    }

    this.logger.log(
      ` Ingested document '${dto.title}' (${insertedChunks?.length || 0} chunks stored).`,
    );

    return {
      document: doc,
      chunkCount: textChunks.length,
    };
  }

  /**
   * Lists all uploaded Knowledge Base documents.
   */
  async listDocuments(): Promise<any[]> {
    const { data, error } = await this.supabaseAdmin
      .from('kb_documents')
      .select('*, kb_chunks(count)')
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to list documents: ${error.message}`);
    }
    return (data || []).map((doc: any) => ({
      ...doc,
      chunk_count: doc.kb_chunks?.[0]?.count || 0,
    }));
  }

  /**
   * Deletes a Knowledge Base document (cascades to kb_chunks).
   */
  async deleteDocument(docId: string): Promise<boolean> {
    const { error } = await this.supabaseAdmin
      .from('kb_documents')
      .delete()
      .eq('id', docId);

    if (error) {
      throw new Error(`Failed to delete document ${docId}: ${error.message}`);
    }
    return true;
  }

  /**
   * Extracts plain text and markdown structure from a base64 encoded PDF document using Gemini multimodal vision/OCR.
   */
  async extractTextFromPdf(
    fileBase64: string,
    fileName?: string,
  ): Promise<{ text: string; charCount: number; title: string }> {
    const apiKey =
      process.env.GEMINI_PAID_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Gemini API key is required for document text extraction',
      );
    }

    const cleanBase64 = fileBase64
      .replace(/^data:application\/pdf;base64,/, '')
      .replace(/^data:[^;]+;base64,/, '')
      .trim();
    const cleanTitle = fileName
      ? fileName
          .replace(/\.[^/.]+$/, '')
          .replace(/[-_]/g, ' ')
          .trim()
      : 'Document';

    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });

      const modelName = process.env.GEMINI_OCR_MODEL || 'gemini-2.5-flash';
      const response: any = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType: 'application/pdf',
            },
          },
          'Extract and return the full text content of this PDF document accurately in clean Markdown format. Preserve all headings, SOP numbers, clauses, bullet points, policies, tables, and specifications. Do not include any conversational commentary — output only the clean extracted document content.',
        ],
      });

      const text = (response?.text || '').trim();
      if (!text) {
        throw new Error(
          'No text could be extracted from the uploaded PDF document.',
        );
      }

      this.logger.log(
        `Extracted ${text.length} characters from PDF '${cleanTitle}'.`,
      );

      return {
        text,
        charCount: text.length,
        title: cleanTitle,
      };
    } catch (err: any) {
      this.logger.error('Failed to extract text from PDF via Gemini:', err);
      throw new Error(
        `Failed to extract text from PDF document: ${err.message}`,
      );
    }
  }
}

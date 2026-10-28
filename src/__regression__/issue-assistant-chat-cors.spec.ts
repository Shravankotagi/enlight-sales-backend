import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CORS_ALLOWED_HEADERS,
  CORS_ALLOWED_HEADERS_VALUE,
} from '../common/http/cors';
import { ChatbotService } from '../modules/chatbot/chatbot.service';

describe('assistant chat request contract', () => {
  it('allows only the headers the browser already sends', () => {
    expect([...CORS_ALLOWED_HEADERS]).toEqual([
      'Content-Type',
      'Accept',
      'Authorization',
      'X-Requested-With',
      'Origin',
    ]);
    expect(
      CORS_ALLOWED_HEADERS.map((header) => header.toLowerCase()),
    ).not.toContain('x-user-token');
    expect(CORS_ALLOWED_HEADERS_VALUE).not.toMatch(/x-user-token/i);

    const main = readFileSync(join(__dirname, '../main.ts'), 'utf8');
    expect(main).toContain('allowedHeaders: [...CORS_ALLOWED_HEADERS]');
    expect(main).toContain(
      "res.header('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS_VALUE)",
    );
  });

  it('refuses a chat message when the signed-in account has no phone', async () => {
    const guardrails = {
      checkRateLimit: jest.fn(),
      isDailySpendCapExceeded: jest.fn(),
    };
    const service = new ChatbotService(
      { getAdminClient: () => ({}) } as any,
      guardrails as any,
    );

    await expect(
      service.processChatMessage(
        { userId: 'employee-1', email: '', role: 'salesperson' },
        '2. Update Inquiry',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(guardrails.checkRateLimit).not.toHaveBeenCalled();
  });
});

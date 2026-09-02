import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZohoService } from './zoho.service';

@Controller('zoho/webhook')
export class ZohoWebhookController {
  private readonly logger = new Logger(ZohoWebhookController.name);

  constructor(private readonly zohoService: ZohoService) {}

  /**
   * GET /zoho/webhook
   * Verification challenge endpoint for webhook setup.
   */
  @Get()
  verifyWebhook(@Query('challenge') challenge?: string) {
    this.logger.log('Zoho Webhook verification request received');
    return (
      challenge || { status: 'ok', service: 'Zoho Bigin Webhook Receiver' }
    );
  }

  /**
   * POST /zoho/webhook
   * Real-time webhook receiver for Zoho Bigin automation events.
   * Responds immediately with HTTP 200 OK (<50ms) and processes asynchronously.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  handleWebhook(@Body() payload: any, @Req() req: any) {
    const eventType =
      payload?.event ||
      payload?.event_type ||
      req.headers['x-zoho-event'] ||
      'unknown';
    const entityType = payload?.module || payload?.entity_type || 'unknown';
    const entityId =
      payload?.id || payload?.data?.id || payload?.entity_id || 'unknown';

    this.logger.log(
      `[ZohoWebhook] Received event: ${eventType} for ${entityType} (ID: ${entityId})`,
    );

    // Process asynchronously without blocking response
    setImmediate(async () => {
      try {
        await this.zohoService.processBiginWebhookEvent(payload);
      } catch (err: any) {
        this.logger.error(
          `[ZohoWebhook] Async processing error: ${err.message}`,
        );
      }
    });

    return {
      status: 'acknowledged',
      event: eventType,
      timestamp: new Date().toISOString(),
    };
  }
}

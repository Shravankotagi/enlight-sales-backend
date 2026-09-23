import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';

export interface UsageRecord {
  promptTokens: number;
  completionTokens: number;
  embeddingTokens?: number;
}

@Injectable()
export class GuardrailsService {
  private readonly logger = new Logger(GuardrailsService.name);

  // In-memory sliding window rate limiter: Map<userId, timestamp[]>
  private readonly requestWindows = new Map<string, number[]>();

  constructor(private readonly supabaseService: SupabaseService) {}

  private get supabaseAdmin() {
    return this.supabaseService.getAdminClient();
  }

  /**
   * Enforces per-user rate limiting using a 60-second sliding window.
   * Default: 15 requests per minute per user.
   */
  checkRateLimit(userId: string): void {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxRequests = parseInt(
      process.env.CHATBOT_RATE_LIMIT_PER_MIN || '15',
      10,
    );

    const userTimestamps = this.requestWindows.get(userId) || [];
    // Keep timestamps within the last 60 seconds
    const validTimestamps = userTimestamps.filter((ts) => now - ts < windowMs);

    if (validTimestamps.length >= maxRequests) {
      this.logger.warn(
        `Rate limit exceeded for user ${userId} (${validTimestamps.length}/${maxRequests} req/min)`,
      );

      // Audit log rate limit trigger
      this.supabaseAdmin
        .from('audit_log')
        .insert({
          user_id: userId,
          tool_name: 'rate_limit_block',
          args: { limit: maxRequests, windowMs },
          row_count: 0,
          details: { error: '429 Too Many Requests' },
          created_at: new Date().toISOString(),
        })
        .then();

      throw new HttpException(
        'Rate limit exceeded. You have sent too many requests in a short period. Please wait a minute before trying again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    validTimestamps.push(now);
    this.requestWindows.set(userId, validTimestamps);
  }

  /**
   * Screens input for prompt injection, jailbreak attempts, or system instruction overrides.
   */
  async screenInput(
    input: string,
  ): Promise<{ safe: boolean; reason?: string }> {
    const text = input.trim();
    if (!text) return { safe: true };

    // Explicit prompt injection and system override patterns
    const PROMPT_INJECTION_PATTERNS = [
      /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
      /system\s+override\s*:/i,
      /reveal\s+(?:your\s+)?system\s+prompt/i,
      /you\s+are\s+now\s+(?:dan|developer\s+mode|unfiltered)/i,
      /\b(?:drop\s+table|delete\s+from\s+users|truncate\s+table)\b/i,
    ];

    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        this.logger.warn(
          `Security violation detected by guardrail regex: "${text.slice(0, 50)}"`,
        );
        return { safe: false, reason: 'security_violation' };
      }
    }

    return { safe: true };
  }

  /**
   * Wraps retrieved data (KB chunks, customer profile, operational rows) in explicit untrusted content tags.
   */
  wrapUntrustedContent(sourceName: string, content: string): string {
    return `<untrusted_content source="${sourceName}">\n${content}\n</untrusted_content>`;
  }

  /**
   * Tracks daily Gemini token usage and estimated USD cost. Checks spend cap & fires alerts.
   * Default daily cap: $5.00 USD.
   */
  async recordUsageAndCheckSpendCap(
    usage: UsageRecord,
    userId?: string,
  ): Promise<{ estimatedCostUsd: number; capExceeded: boolean }> {
    const dailyCapUsd = parseFloat(
      process.env.CHATBOT_DAILY_SPEND_CAP_USD || '5.00',
    );

    // Cost estimation per token (Gemini 3.x Flash pricing estimates)
    const inputCostPerToken = 0.075 / 1000000;
    const outputCostPerToken = 0.3 / 1000000;
    const embedCostPerToken = 0.025 / 1000000;

    const callCost =
      usage.promptTokens * inputCostPerToken +
      usage.completionTokens * outputCostPerToken +
      (usage.embeddingTokens || 0) * embedCostPerToken;

    const todayStr = new Date().toISOString().split('T')[0];

    try {
      // Fetch highest usage record for today
      const { data: existingRecords } = await this.supabaseAdmin
        .from('daily_llm_usage')
        .select('*')
        .eq('usage_date', todayStr)
        .order('estimated_cost_usd', { ascending: false });

      const existing =
        existingRecords && existingRecords.length > 0
          ? existingRecords[0]
          : null;

      let currentCost = callCost;
      let totalPrompt = usage.promptTokens;
      let totalCompletion = usage.completionTokens;
      let totalEmbedding = usage.embeddingTokens || 0;
      let alertSent = false;
      let capExceeded = false;

      if (existing) {
        currentCost = (parseFloat(existing.estimated_cost_usd) || 0) + callCost;
        totalPrompt = (existing.total_prompt_tokens || 0) + usage.promptTokens;
        totalCompletion =
          (existing.total_completion_tokens || 0) + usage.completionTokens;
        totalEmbedding =
          (existing.total_embedding_tokens || 0) + (usage.embeddingTokens || 0);
        alertSent = existing.alert_sent || false;
        capExceeded = existing.cap_exceeded || false;
      }

      // Check if spend cap is reached
      if (currentCost >= dailyCapUsd) {
        capExceeded = true;
        this.logger.error(
          `CRITICAL: Daily Gemini Spend Cap Exceeded! ($${currentCost.toFixed(4)} / $${dailyCapUsd.toFixed(2)})`,
        );
      } else if (currentCost >= dailyCapUsd * 0.8 && !alertSent) {
        alertSent = true;
        this.logger.warn(
          `WARNING: Daily Gemini Spend Cap Reached 80% Threshold ($${currentCost.toFixed(4)} / $${dailyCapUsd.toFixed(2)})`,
        );

        // Log alert to audit_log
        await this.supabaseAdmin.from('audit_log').insert({
          user_id: userId || 'system',
          tool_name: 'spend_cap_alert',
          args: { currentCost, dailyCapUsd, threshold: '80%' },
          row_count: 0,
          details: { alert: 'Spend cap 80% reached' },
          created_at: new Date().toISOString(),
        });
      }

      if (capExceeded && (!existing || !existing.cap_exceeded)) {
        await this.supabaseAdmin.from('audit_log').insert({
          user_id: userId || 'system',
          tool_name: 'spend_cap_exceeded_block',
          args: { currentCost, dailyCapUsd },
          row_count: 0,
          details: { alert: 'Daily spend cap 100% exceeded' },
          created_at: new Date().toISOString(),
        });
      }

      // Upsert today's usage row
      const payload: any = {
        usage_date: todayStr,
        total_prompt_tokens: totalPrompt,
        total_completion_tokens: totalCompletion,
        total_embedding_tokens: totalEmbedding,
        estimated_cost_usd: currentCost,
        alert_sent: alertSent,
        cap_exceeded: capExceeded,
        updated_at: new Date().toISOString(),
      };
      if (existing && existing.id) {
        payload.id = existing.id;
      }

      await this.supabaseAdmin
        .from('daily_llm_usage')
        .upsert(payload, { onConflict: 'usage_date' });

      return {
        estimatedCostUsd: currentCost,
        capExceeded,
      };
    } catch (err: any) {
      this.logger.error(`Error tracking spend cap: ${err.message}`);
      return { estimatedCostUsd: 0, capExceeded: false };
    }
  }

  /**
   * Checks if daily spend cap is currently exceeded.
   */
  async isDailySpendCapExceeded(): Promise<boolean> {
    const todayStr = new Date().toISOString().split('T')[0];
    const { data: existingRecords } = await this.supabaseAdmin
      .from('daily_llm_usage')
      .select('cap_exceeded, estimated_cost_usd')
      .eq('usage_date', todayStr)
      .order('estimated_cost_usd', { ascending: false });

    if (existingRecords && existingRecords.length > 0) {
      for (const data of existingRecords) {
        const dailyCapUsd = parseFloat(
          process.env.CHATBOT_DAILY_SPEND_CAP_USD || '5.00',
        );
        const currentCost = parseFloat(data.estimated_cost_usd) || 0;
        if (data.cap_exceeded || currentCost >= dailyCapUsd) {
          return true;
        }
      }
    }
    return false;
  }
}

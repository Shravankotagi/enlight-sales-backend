import { Injectable, Logger } from '@nestjs/common';

export interface CustomerHealthSignals {
  sentiment:
    | 'new_prospect'
    | 'quoting'
    | 'discovery'
    | 'positive'
    | 'warning'
    | 'critical'
    | 'dormant';
  cadence_health: string;
  revenue_signal: string;
  quality_signal: string;
  executive_summary: string;
  recommended_action?: string;
}

export interface CustomerInsightsInput {
  customerName: string;
  segment?: string;
  churnRisk?: string;
  daysSinceOrder: number | null;
  cadenceDays: number;
  totalOrders: number;
  totalTonnage: number;
  lifetimeValue: number;
  openComplaints: number;
  totalComplaints: number;
  deals: any[];
  inquiries: any[];
  visits: any[];
  complaints: any[];
  assignedSalespersonName?: string;
}

@Injectable()
export class CustomerInsightsService {
  private readonly logger = new Logger(CustomerInsightsService.name);

  /**
   * Generates dynamic AI account insights for a customer.
   * Leverages Gemini (gemini-3.1-flash-lite / gemini-2.5-flash-lite) with a rapid deterministic fallback.
   */
  async generateInsights(
    input: CustomerInsightsInput,
  ): Promise<CustomerHealthSignals> {
    const fallback = this.generateDeterministicInsights(input);

    const apiKey =
      process.env.GEMINI_API_KEY ||
      process.env.GEMINI_PAID_API_KEY ||
      process.env.GEMINI_API_KEY_1;

    if (!apiKey) {
      return fallback;
    }

    try {
      // Build lightweight prompt payload
      const promptPayload = {
        account_name: input.customerName,
        segment: input.segment || 'new',
        assigned_salesperson: input.assignedSalespersonName || 'Unassigned',
        metrics: {
          total_orders: input.totalOrders,
          total_tonnage_mt: input.totalTonnage,
          days_since_last_order: input.daysSinceOrder,
          order_frequency_cadence_days: input.cadenceDays,
          churn_risk: input.churnRisk || 'active',
          open_complaints_count: input.openComplaints,
          total_complaints_count: input.totalComplaints,
        },
        recent_deals: (input.deals || []).slice(0, 3).map((d) => ({
          po_number: d.po_number || d.customer_name || 'Confirmed Order',
          date: d.won_at || d.created_at,
          amount: Number(d.total_amount) || 0,
          items: Array.isArray(d.deal_items)
            ? d.deal_items
                .map(
                  (i: any) =>
                    `${i.sku_text || 'Item'} (${i.quantity || 0} ${i.unit || 'MT'})`,
                )
                .join(', ')
            : 'Standard Spec',
        })),
        recent_inquiries: (input.inquiries || []).slice(0, 3).map((inq) => ({
          date: inq.created_at,
          status: inq.status,
          channel: inq.channel || 'whatsapp',
          requested_items: Array.isArray(inq.line_items)
            ? inq.line_items
                .map(
                  (i: any) =>
                    `${i.sku_text || i.grade || 'Item'} (${i.quantity || 0} ${i.unit || 'MT'})`,
                )
                .join(', ')
            : inq.raw_text?.slice(0, 100) || 'General Inquiry',
        })),
        recent_visits: (input.visits || []).slice(0, 3).map((v) => ({
          date: v.visit_date || v.created_at,
          purpose: v.purpose,
          remarks: v.remarks?.slice(0, 120) || 'Visit conducted',
        })),
        complaints_summary: (input.complaints || []).slice(0, 3).map((c) => ({
          type: c.complaint_type,
          product: c.affected_product,
          status: c.status,
          reported_at: c.reported_at,
        })),
      };

      const systemInstruction = `You are the AI Sales Assistant for Enlight Metals (an industrial B2B metal distributor).
Your job is to generate a short, easy-to-understand account summary for the sales executive.

Tone & Style Guidelines:
- Use simple, direct, natural English that any salesperson can understand at a glance.
- Keep it concise: strictly 1 to 2 short sentences (max 30-40 words).
- Avoid robotic, stiff corporate jargon (never use phrases like "is currently actively engaged with X confirmed orders" or "on-track procurement velocity").
- Be specific: mention the actual product types (e.g., CRCA, GI Coils, HR Plates, TMT), recent order timelines, and open issues in plain terms.

Context Rules & Examples:
1. New Prospect (0 orders, 0 visits, 0 inquiries):
   - Example: "New prospect account with no past orders or meetings yet. Needs introductory outreach to share our product catalog."
2. Lead with Inquiries (0 orders, active inquiries/RFQs):
   - Example: "They lead currently reviewing quotations for 15 MT CRCA coil. Follow up on pending pricing to close the first deal."
3. Lead with Visits (0 orders, sales meetings logged):
   - Example: "Sales meeting conducted on Feb 22 regarding steel requirements. Awaiting quotation submission."
4. Active Buyer (>5 orders, steady ordering):
   - Example: "Regular customer with n orders totaling 85 MT (mostly GI Coils). Last ordered 12 days ago with zero quality complaints."
5. At Risk / Cadence Overdue (>35-45 days without order):
   - Example: "Usually orders monthly, but hasn't placed an order in 42 days. Due for a re-order check-in."
6. Open Complaints:
   - Example: "This Buyer has 1 open complaint regarding 50x50 Angle dimensions. Needs resolution before quoting new items."
7. Dormant Account (>90 days without order):
   - Example: "Past customer with no orders in over 3 months. Needs re-engagement with fresh price sheets."

Output STRICT JSON (no markdown formatting, no code blocks):
{
  "sentiment": "new_prospect" | "quoting" | "discovery" | "positive" | "warning" | "critical" | "dormant",
  "executive_summary": "Short 1-2 sentence summary in plain salesperson language."
}`;

      const aiResponse = await this.callGeminiWithTimeout(
        apiKey,
        systemInstruction,
        JSON.stringify(promptPayload),
        4000,
      );

      if (aiResponse) {
        const cleaned = aiResponse
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();
        const parsed = JSON.parse(cleaned);

        if (parsed.executive_summary && parsed.sentiment) {
          return {
            sentiment: this.normalizeSentiment(parsed.sentiment, input),
            cadence_health: fallback.cadence_health,
            revenue_signal: fallback.revenue_signal,
            quality_signal: fallback.quality_signal,
            executive_summary: parsed.executive_summary,
          };
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `AI insights generation failed, using fallback: ${err?.message || err}`,
      );
    }

    return fallback;
  }

  /**
   * Deterministic, rule-based fallback in simple, human-like plain language.
   */
  generateDeterministicInsights(
    input: CustomerInsightsInput,
  ): CustomerHealthSignals {
    const {
      customerName,
      daysSinceOrder,
      cadenceDays,
      totalOrders,
      totalTonnage,
      openComplaints,
      deals = [],
      inquiries = [],
      visits = [],
    } = input;

    // Extract product names from recent deals or inquiries
    let topProduct = '';
    if (
      deals.length > 0 &&
      Array.isArray(deals[0].deal_items) &&
      deals[0].deal_items.length > 0
    ) {
      topProduct = deals[0].deal_items[0].sku_text || '';
    } else if (
      inquiries.length > 0 &&
      Array.isArray(inquiries[0].line_items) &&
      inquiries[0].line_items.length > 0
    ) {
      topProduct =
        inquiries[0].line_items[0].sku_text ||
        inquiries[0].line_items[0].grade ||
        '';
    }

    // Case 1: Brand New Prospect (0 orders, 0 inquiries, 0 visits)
    if (totalOrders === 0 && inquiries.length === 0 && visits.length === 0) {
      return {
        sentiment: 'new_prospect',
        cadence_health: 'New Prospect',
        revenue_signal: 'No transaction history',
        quality_signal: 'No complaints logged',
        executive_summary: `New prospect account with no past orders or visits yet. Reach out to introduce our products and share the catalog.`,
      };
    }

    // Case 2: Lead with Inquiries / RFQs (0 orders, inquiries > 0)
    if (totalOrders === 0 && inquiries.length > 0) {
      const prodText = topProduct ? ` for ${topProduct}` : '';
      return {
        sentiment: 'quoting',
        cadence_health: 'Quoting in progress',
        revenue_signal: `${inquiries.length} inquiry/RFQ(s)`,
        quality_signal: 'No complaints logged',
        executive_summary: `Active lead currently evaluating quotations${prodText} (${inquiries.length} inquiries logged). Follow up on pricing to close the first deal.`,
      };
    }

    // Case 3: Lead with Sales Visits (0 orders, visits > 0)
    if (totalOrders === 0 && visits.length > 0) {
      return {
        sentiment: 'discovery',
        cadence_health: 'Discovery in progress',
        revenue_signal: `${visits.length} visit(s) conducted`,
        quality_signal: 'No complaints logged',
        executive_summary: `Sales meetings have been conducted with ${customerName} to understand requirements. Awaiting quotation and first order placement.`,
      };
    }

    // Case 4: Long-Term Dormant Account (>90 days without order)
    if (daysSinceOrder !== null && daysSinceOrder > 90) {
      return {
        sentiment: 'dormant',
        cadence_health: `Dormant (${daysSinceOrder}d ago)`,
        revenue_signal: `${totalOrders} orders (${totalTonnage} MT)`,
        quality_signal:
          openComplaints > 0
            ? `${openComplaints} open issue(s)`
            : 'Clean quality history',
        executive_summary: `Past customer with ${totalOrders} orders, but no new purchases in ${daysSinceOrder} days. Reach out with updated pricing to re-engage.`,
      };
    }

    // Case 5: Overdue / Cadence Delayed (>45 days or > cadence)
    if (daysSinceOrder !== null && daysSinceOrder > 45) {
      return {
        sentiment: 'critical',
        cadence_health: `Overdue (${daysSinceOrder}d vs ${cadenceDays}d cadence)`,
        revenue_signal: `${totalOrders} orders (${totalTonnage} MT)`,
        quality_signal:
          openComplaints > 0
            ? `${openComplaints} open complaint(s)`
            : 'No open complaints',
        executive_summary: `Usually orders every ${cadenceDays} days, but has not placed an order in ${daysSinceOrder} days. Check in to secure the next order.`,
      };
    }

    // Case 6: Re-order Approaching (35-45 days)
    if (daysSinceOrder !== null && daysSinceOrder >= 35) {
      return {
        sentiment: 'warning',
        cadence_health: `Re-order due (${daysSinceOrder}d ago)`,
        revenue_signal: `${totalOrders} orders (${totalTonnage} MT)`,
        quality_signal:
          openComplaints > 0
            ? `${openComplaints} open complaint(s)`
            : 'No open complaints',
        executive_summary: `Approaching regular re-order window (last ordered ${daysSinceOrder} days ago). Send updated rates to prepare the next quotation.`,
      };
    }

    // Case 7: Open Complaints on Active Account
    if (openComplaints > 0) {
      return {
        sentiment: 'critical',
        cadence_health: 'Attention required',
        revenue_signal: `${totalOrders} orders (${totalTonnage} MT)`,
        quality_signal: `${openComplaints} open complaint ticket(s)`,
        executive_summary: `Active customer with ${totalOrders} orders (${totalTonnage} MT), but has ${openComplaints} unresolved complaint ticket(s) requiring immediate attention.`,
      };
    }

    // Case 8: Healthy Active Buyer
    const daysText =
      daysSinceOrder !== null
        ? `Last ordered ${daysSinceOrder} days ago`
        : 'Recent order on track';
    const prodSnippet = topProduct ? ` (mostly ${topProduct})` : '';

    return {
      sentiment: 'positive',
      cadence_health: `On track (${daysSinceOrder ?? 0}d ago)`,
      revenue_signal: `${totalOrders} orders (${totalTonnage} MT)`,
      quality_signal: 'Zero open complaints',
      executive_summary: `Regular customer with ${totalOrders} orders totaling ${totalTonnage.toLocaleString('en-IN')} MT${prodSnippet}. ${daysText} with zero quality complaints.`,
    };
  }

  /**
   * Helper to normalize sentiment string from LLM to valid allowed union.
   */
  private normalizeSentiment(
    val: string,
    input: CustomerInsightsInput,
  ): CustomerHealthSignals['sentiment'] {
    const s = String(val || '')
      .toLowerCase()
      .trim();
    if (
      [
        'new_prospect',
        'quoting',
        'discovery',
        'positive',
        'warning',
        'critical',
        'dormant',
      ].includes(s)
    ) {
      return s as CustomerHealthSignals['sentiment'];
    }
    if (s === 'healthy' || s === 'active') return 'positive';
    if (s === 'reorder_due' || s === 'reorder') return 'warning';
    if (s === 'at_risk') return 'warning';
    if (s === 'churning' || s === 'attention_required') return 'critical';
    if (input.totalOrders === 0) return 'new_prospect';
    return 'positive';
  }

  /**
   * Fast invocation wrapper with timeout to prevent blocking customer detail loads.
   */
  private async callGeminiWithTimeout(
    apiKey: string,
    systemInstruction: string,
    userPrompt: string,
    timeoutMs: number,
  ): Promise<string | null> {
    return new Promise(async (resolve) => {
      const timer = setTimeout(() => {
        resolve(null);
      }, timeoutMs);

      try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });
        const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `${systemInstruction}\n\nAccount Context:\n${userPrompt}`,
                },
              ],
            },
          ],
        });

        clearTimeout(timer);
        resolve(response.text || null);
      } catch {
        // Retry with LangChain ChatGoogleGenerativeAI fallback
        try {
          const { ChatGoogleGenerativeAI } =
            await import('@langchain/google-genai');
          const { HumanMessage, SystemMessage } =
            await import('@langchain/core/messages');

          const model = new ChatGoogleGenerativeAI({
            model: 'gemini-3.1-flash-lite',
            apiKey: apiKey,
            temperature: 0.1,
            maxRetries: 1,
          });

          const result = await model.invoke([
            new SystemMessage(systemInstruction),
            new HumanMessage(userPrompt),
          ]);

          clearTimeout(timer);
          resolve(
            typeof result.content === 'string'
              ? result.content
              : JSON.stringify(result.content),
          );
        } catch {
          clearTimeout(timer);
          resolve(null);
        }
      }
    });
  }
}

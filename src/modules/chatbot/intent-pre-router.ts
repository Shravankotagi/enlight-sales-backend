import { CallerContext } from './tools/chatbot-tool.interface';

export interface PreRouteResult {
  matched: boolean;
  toolName?: string;
  toolArgs?: Record<string, any>;
  reason?: string;
}

/**
 * Intent Pre-Router for Enlight Metals Sales OS Chatbot.
 * Deterministically routes unambiguous field mutations, direct ID searches,
 * and high-confidence operational commands before invoking the LLM, eliminating LLM hallucination and routing failures.
 */
export class IntentPreRouter {
  /**
   * Evaluates a user message and returns a tool route if a high-confidence deterministic pattern matches.
   */
  static evaluate(messageText: string, caller: CallerContext): PreRouteResult {
    void caller;
    const text = (messageText || '').trim();
    if (!text) return { matched: false };
    const lower = text.toLowerCase();

    // 1. Direct Inquiry ID Search (e.g. "#INQ-2C788F", "Status of INQ-922CBC", "check #INQ-00151B")
    const standaloneInqMatch = text.match(
      /^\s*(?:status\s+of|check|show|get|view|search)?\s*(#?INQ-[A-Za-z0-9]+)\s*$/i,
    );
    if (standaloneInqMatch) {
      const inqId = standaloneInqMatch[1].toUpperCase();
      return {
        matched: true,
        toolName: 'get_inquiries',
        toolArgs: { inquiry_id: inqId.startsWith('#') ? inqId : `#${inqId}` },
        reason: 'direct_inquiry_id_lookup',
      };
    }

    // 2. Direct Deal ID Search (e.g. "#DEAL-BDAD85", "Status of DEAL-123456")
    const standaloneDealMatch = text.match(
      /^\s*(?:status\s+of|check|show|get|view|search)?\s*(#?DEAL-[A-Za-z0-9]+)\s*$/i,
    );
    if (standaloneDealMatch) {
      const dealId = standaloneDealMatch[1].toUpperCase();
      return {
        matched: true,
        toolName: 'get_my_open_deals',
        toolArgs: { deal_id: dealId.startsWith('#') ? dealId : `#${dealId}` },
        reason: 'direct_deal_id_lookup',
      };
    }

    // 3. Customer Profile Mutations (Field updates: phone, contact person, GST, order frequency, address, rep reassignment)
    const isProfileMutation =
      (/\b(?:change|update|set|add|modify|assign|reassign|edit|attach)\b/i.test(
        lower,
      ) &&
        (/\b(?:phone|number|mobile|contact|contact_person|contact_no|contact_number|gst|gstin|frequency|order_frequency|cadence|address|location|city|salesperson|sales\s+rep|rep)\b/i.test(
          lower,
        ) ||
          /\b(?:name\s*[-:]|number\s*[-:]|phone\s*[-:]|contact\s*[-:])\b/i.test(
            lower,
          ))) ||
      /\b(?:name\s*[-:]\s*[a-zA-Z\s]+.*number\s*[-:]\s*\d+)/i.test(lower) ||
      /\b(?:order\s+frequency\s+to\s+\d+|set\s+[a-zA-Z0-9\s&.-]+\s+order\s+frequency)/i.test(
        lower,
      ) ||
      /\b(?:assign|reassign)\s+[a-zA-Z0-9\s&.-]+\s+to\s+(?:salesperson|rep|sales\s+rep)\b/i.test(
        lower,
      );

    // Ensure it's not a visit log/query or inquiry rate update
    const isVisitOrDealContext =
      /\b(?:visited|had\s+a\s+meeting|plant\s+visit|site\s+visit|inquiry\s+for|quote\s+for)\b/i.test(
        lower,
      ) &&
      !/\b(?:customer\s+profile|profile|frequency|gst|gstin|order\s+frequency)\b/i.test(
        lower,
      );

    if (isProfileMutation && !isVisitOrDealContext) {
      return {
        matched: true,
        toolName: 'update_customer_profile',
        toolArgs: { text },
        reason: 'deterministic_profile_mutation',
      };
    }

    // 4. High-Confidence Payment Logging
    const isExplicitPayment =
      (/\b(?:received\s+payment|received\s+advance|payment\s+received)\b/i.test(
        lower,
      ) &&
        /\b(?:from|by)\s+[a-zA-Z0-9\s&.-]+/i.test(lower)) ||
      (/\b[a-zA-Z0-9\s&.-]+\s+paid\s+(?:rs\.?|inr|₹)?\s*[\d,]+(?:\s*lakhs?|\s*k)?\b/i.test(
        lower,
      ) &&
        !/\b(?:chequered|checkered|how\s+much|balance|pending)\b/i.test(lower));

    if (
      isExplicitPayment &&
      !lower.includes('show') &&
      !lower.includes('list') &&
      !lower.includes('which')
    ) {
      return {
        matched: true,
        toolName: 'log_payment',
        toolArgs: { text },
        reason: 'deterministic_payment_logging',
      };
    }

    return { matched: false };
  }
}

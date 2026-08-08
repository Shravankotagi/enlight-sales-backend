/**
 * orchestrator.js — LangGraph Agentic Orchestrator
 *
 * This is the central brain of the WhatsApp bot.
 * It replaces the giant if/else routing tree in webhook.js.
 *
 * Flow:
 *   [START] → [agent_node] → (tool calls?) → [tool_node] → [agent_node] → ... → [END]
 *
 * Primary Model: Google Gemini (gemini-3.1-flash-lite)
 */

const { StateGraph, START, END, Annotation, MessagesAnnotation } = require('@langchain/langgraph');
const { HumanMessage, SystemMessage, AIMessage, ToolMessage } = require('@langchain/core/messages');
const { createTools }        = require('./tools');
const { invokeWithFallback } = require('./modelRouter');
const { getChatHistory, addChatHistory, getActiveContextPrompt } = require('./memory');

// ── System Prompt — Persona & Instructions ────────────────────────────────

const SYSTEM_PROMPT = `You are the Enlight Metals Sales Intelligence Agent — a powerful AI assistant embedded in WhatsApp for the Enlight Metals sales team.

You help salespersons log their daily sales activities (visits, deals, payments, complaints, follow-ups, customer onboarding) and retrieve insights from the CRM database.

## Your Personality
- Professional, supportive, and energetic
- You speak naturally — never like a robot or a form
- Use relevant emojis thoughtfully, not excessively
- Mix English and Hindi/Hinglish naturally if the salesperson does
- Celebrate wins ("Great work on closing that deal! 🎉")
- Be concise but complete — don't pad with unnecessary sentences

## How You Work
1. Read the salesperson's message carefully
2. Understand the INTENT — what they're reporting or asking
3. Call the appropriate tool(s) to log data or retrieve information
4. Read the tool results
5. Write a natural, intelligent reply that:
   - Confirms what was done (if logging)
   - Provides the requested data clearly (if querying)
   - Highlights any important missing information
   - Suggests next steps if relevant

## Important Rules
- ALWAYS call at least one tool before responding (never guess about database state)
- MULTI-INTENT MESSAGES: If a message contains multiple activities (e.g. a site visit AND a deal won, or a payment AND a follow-up), call MULTIPLE tools in parallel in the same turn! (e.g. call log_customer_visit AND update_deal_stage).
- INTENT CLARIFICATION: If a message is vague or missing essential context to distinguish between payment vs deal vs complaint (e.g. "Mehta 5000"), ask the salesperson a friendly clarifying question with quick choices instead of guessing!
- If the message contains ANY product requirement, tonnage, material request, or RFQ — EVEN if you also called log_customer_visit — you MUST ALSO call update_deal_stage. These two tools are NOT mutually exclusive. A visit message that also mentions a product requirement needs BOTH tools called in the same turn.
- If the message contains profile details (mobile number, phone, owner, contact person, GST, location) — EVEN WITHOUT A COMPANY NAME — ALWAYS call get_conversation_context or onboard_new_customer immediately to update the customer's profile. Never ask "which company" without calling get_conversation_context first!
- If the customer name is ambiguous, call get_conversation_context first to check the active session
- Never reject a message because a customer "isn't registered" — the tools handle auto-registration
- For queries (questions about data), use query_my_data — never make up numbers
- Keep responses under 300 words unless the user explicitly asked for a detailed report

## Response Format
- Use *bold* for important values (customer names, amounts, dates)
- Use bullet points for lists
- Always end with a KRA dashboard confirmation line when logging activities
- For data queries, format numbers clearly (₹5,00,000 not 500000)`;

// ── State Definition ──────────────────────────────────────────────────────

const OrchestratorState = Annotation.Root({
  ...MessagesAnnotation.spec,
  senderPhone:     Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  employeeName:    Annotation({ reducer: (x, y) => y ?? x, default: () => 'Salesperson' }),
  messageType:     Annotation({ reducer: (x, y) => y ?? x, default: () => 'text' }),
  imageBuffer:     Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  imageMimeType:   Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  toolsUsed:       Annotation({ reducer: (x, y) => [...(x || []), ...(y || [])], default: () => [] }),
});

// ── Deterministic Intent Anchor ───────────────────────────────────────────

function getDeterministicIntentHint(text) {
  if (!text || typeof text !== 'string') return '';
  const lower = text.toLowerCase();

  const anchors = [];

  if (/\b(payment|advance|cheque|upi|neft|rtgs|invoice|balance|outstanding|baki|paid|amount received|payment collected)\b/i.test(lower)) {
    anchors.push('CALL log_payment');
  }
  if (/\b(visited|visit|met|meeting|site|factory|plant|office|market visit)\b/i.test(lower)) {
    anchors.push('CALL log_customer_visit');
  }
  if (/\b(complaint|defective|damaged|scratch|rust|quality|rejected|rejection|faulty)\b/i.test(lower)) {
    anchors.push('CALL log_complaint');
  }
  if (/\b(requires|requirement|need|inquiry|quote|quotation|rfq|ton|mt|coil|plate|sheet|tmt|bar|hr|cr|ms)\b/i.test(lower)) {
    anchors.push('CALL update_deal_stage');
  }
  if (/\b(won|lost|closed|confirmed|order placed|po received|deal done|finalized)\b/i.test(lower)) {
    anchors.push('CALL update_deal_stage');
  }

  if (anchors.length === 0) return '';

  return `\n[REQUIRED TOOL CALLS THIS TURN: ${anchors.join(' AND ')}. You MUST call ALL of these tools before responding. Missing any = incomplete action.]`;
}

/**
 * Router: Decides whether to continue to tools or end the conversation.
 */
function shouldContinue(state) {
  const lastMessage = state.messages[state.messages.length - 1];

  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return 'tools';
  }

  return END;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Main entry point — called from webhook.js for every incoming message.
 */
async function runOrchestrator(text, senderPhone, options = {}) {
  const {
    employeeName  = 'Salesperson',
    messageType   = 'text',
    imageBuffer   = null,
    imageMimeType = null,
  } = options;

  try {
    console.log(`[Orchestrator] Processing: "${text?.substring(0, 80)}..." from ${senderPhone}`);

    // Create tools with senderPhone pre-bound per request
    const TOOLS = createTools(senderPhone);

    // Request-scoped Agent Node
    const inlineAgentNode = async (state) => {
      const { messages, senderPhone: sp, employeeName: en, messageType: mt } = state;

      const lastHumanMsg = [...messages].reverse().find(
        m => m._getType?.() === 'human' || m.constructor?.name === 'HumanMessage'
      );
      const userText = lastHumanMsg
        ? (typeof lastHumanMsg.content === 'string' ? lastHumanMsg.content : '')
        : '';
      const hasToolResultsAlready = messages.some(
        m => m._getType?.() === 'tool' || m.constructor?.name === 'ToolMessage'
      );
      const intentAnchor = hasToolResultsAlready ? '' : getDeterministicIntentHint(userText);
      const activeContextPrompt = await getActiveContextPrompt(sp);
      const historyMessages = getChatHistory(sp);

      const contextMessages = [
        new SystemMessage(
          SYSTEM_PROMPT +
          `\n\nCurrent salesperson: ${en || 'Salesperson'}\nPhone: ${sp}\nMessage type: ${mt}${activeContextPrompt}${intentAnchor}`
        ),
        ...historyMessages,
        ...messages,
      ];

      let response;
      try {
        response = await invokeWithFallback(contextMessages, TOOLS);
      } catch (err) {
        console.error('[Orchestrator] Model invocation failed:', err.message);

        // Friendly greeting fallback if simple greeting message was sent
        const cleanUserText = userText.trim().toLowerCase().replace(/[^a-z]/gi, '');
        if (['hi', 'hii', 'hiii', 'hello', 'hey', 'namaste', 'hie', 'goodmorning', 'goodevening'].includes(cleanUserText)) {
          return {
            messages: [new AIMessage(`Namaste! 🙏 Welcome to Enlight Metals Sales Intelligence Bot.\n\nHow can I assist you with your deals, customer visits, payments, or inquiries today?`)],
          };
        }

        throw err;
      }

      return { messages: [response] };
    };

    // Request-scoped Tool Node
    const inlineToolNode = async (state) => {
      const { messages } = state;
      const lastAIMsg = [...messages].reverse().find(m => m._getType?.() === 'ai' || m.constructor?.name === 'AIMessage');

      if (!lastAIMsg || !lastAIMsg.tool_calls || lastAIMsg.tool_calls.length === 0) {
        return { messages: [] };
      }

      const toolResults = [];
      const validOutputs = [];

      for (const call of lastAIMsg.tool_calls) {
        const toolObj = TOOLS.find(t => t.name === call.name);
        if (toolObj) {
          try {
            const res = await toolObj.invoke(call.args);
            const resStr = typeof res === 'string' ? res : JSON.stringify(res);
            toolResults.push(new ToolMessage({ content: resStr, tool_call_id: call.id }));
            if (resStr && !resStr.startsWith('Error') && !resStr.startsWith('⚠️')) {
              validOutputs.push(resStr);
            }
          } catch (err) {
            console.error(`[Orchestrator] Tool ${call.name} execution error:`, err.message);
            toolResults.push(new ToolMessage({ content: `Error: ${err.message}`, tool_call_id: call.id }));
          }
        }
      }

      if (validOutputs.length > 0) {
        const finalContent = validOutputs.join('\n\n---\n\n');
        return {
          messages: [...toolResults, new AIMessage(finalContent)],
        };
      }

      return { messages: toolResults };
    };

    // Build per-request graph
    const graph = new StateGraph(OrchestratorState)
      .addNode('agent', inlineAgentNode)
      .addNode('tools', inlineToolNode)
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', shouldContinue)
      .addEdge('tools', 'agent')
      .compile();

    const humanMsg = new HumanMessage(text || 'Image received');

    const finalState = await graph.invoke({
      messages:      [humanMsg],
      senderPhone,
      employeeName,
      messageType,
      imageBuffer:   imageBuffer ? imageBuffer.toString('base64') : null,
      imageMimeType,
    });

    const allMessages = finalState.messages;
    const lastAIMsg = [...allMessages].reverse().find(
      m => m._getType?.() === 'ai' || m.constructor?.name === 'AIMessage'
    );

    let rawReply = typeof lastAIMsg?.content === 'string' ? lastAIMsg.content : '';
    let reply = rawReply
      .replace(/<function\([\s\S]*?<\/function>/gi, '')
      .replace(/<function\([\s\S]*?>/gi, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
      .trim();

    if (!reply) {
      reply = '✅ Activity updated in your CRM & KRA Dashboard!';
    }

    addChatHistory(senderPhone, text, reply);

    console.log(`[Orchestrator] Reply ready (${reply.length} chars)`);
    return reply;

  } catch (err) {
    console.error('[Orchestrator] Fatal error:', err);
    return `⚠️ Something went wrong processing your message. Please try again.\n\nError: ${err.message}`;
  }
}

module.exports = { runOrchestrator };

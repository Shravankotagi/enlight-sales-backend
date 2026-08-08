/**
 * orchestrator.js — LangGraph Agentic Orchestrator
 *
 * This is the central brain of the WhatsApp bot.
 * It replaces the giant if/else routing tree in webhook.js.
 *
 * Flow:
 *   [START] → [agent_node] → (tool calls?) → [tool_node] → [agent_node] → ... → [respond_node] → [END]
 *
 * The agent_node uses Gemini 2.5 Flash to:
 *   1. Understand any message (English, Hindi, Hinglish, typos)
 *   2. Decide which tools to call (can call multiple tools in sequence)
 *   3. Read tool results
 *   4. Write a natural, intelligent final response
 *
 * Key properties:
 *   - Pre-binds senderPhone to every tool call so writes never fail silently
 *   - Never blocks any activity due to missing customer registration
 *   - Handles multi-intent messages (visit + deal update in one message)
 *   - Maintains conversation context across turns
 *   - Falls back to Groq automatically on Gemini rate limits
 *   - All DB writes happen inside tools — fully auditable
 */

const { StateGraph, START, END, Annotation, MessagesAnnotation } = require('@langchain/langgraph');
const { ToolNode }       = require('@langchain/langgraph/prebuilt');
const { HumanMessage, SystemMessage, AIMessage } = require('@langchain/core/messages');
const { createTools }    = require('./tools');
const { invokeWithFallback } = require('./modelRouter');

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

  if (/\b(paid|payment|advance|received|collected|cheque|upi|neft|rtgs|invoice|balance|outstanding|baki)\b/i.test(lower)) {
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

// Global active tools array for the current execution
let currentTools = [];

// ── Nodes ─────────────────────────────────────────────────────────────────

function normalizeGroqToolCalls(response) {
  if (!response) return response;

  if (Array.isArray(response.tool_calls) && response.tool_calls.length > 0) {
    return response;
  }

  const content = typeof response.content === 'string' ? response.content : '';
  if (!content) return response;

  const extractedToolCalls = [];

  // Pattern 1: <function(name){...}> or <function(name){...}></function>
  const pattern1 = /<function\(([^)]+)\)([\s\S]*?)(?:<\/function>|>)/gi;
  let match;
  while ((match = pattern1.exec(content)) !== null) {
    try {
      const name = match[1].trim();
      let rawJson = match[2].replace(/'/g, '"').trim();
      const args = JSON.parse(rawJson);
      extractedToolCalls.push({
        name,
        args,
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: 'tool_call',
      });
    } catch (e) {
      console.warn('[Orchestrator] Failed to parse function call JSON:', match[2], e.message);
    }
  }

  // Pattern 2: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
  const pattern2 = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  while ((match = pattern2.exec(content)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      if (data.name) {
        extractedToolCalls.push({
          name: data.name,
          args: data.arguments || data.args || {},
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          type: 'tool_call',
        });
      }
    } catch (e) {
      console.warn('[Orchestrator] Failed to parse tool_call XML:', match[1], e.message);
    }
  }

  if (extractedToolCalls.length > 0) {
    response.tool_calls = extractedToolCalls;
    response.content = content
      .replace(/<function\([\s\S]*?<\/function>/gi, '')
      .replace(/<function\([\s\S]*?>/gi, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
      .trim();
  }

  return response;
}

/**
 * Agent Node: The LLM that reads messages, decides tool calls, and writes responses.
 * Re-runs after each tool_node execution until no more tool calls are needed.
 */
async function agentNode(state) {
  const { messages, senderPhone, employeeName, messageType } = state;

  const lastHumanMsg = [...messages].reverse().find(m => m._getType?.() === 'human' || m.constructor?.name === 'HumanMessage');
  const userText = lastHumanMsg ? (typeof lastHumanMsg.content === 'string' ? lastHumanMsg.content : '') : '';
  const intentAnchor = getDeterministicIntentHint(userText);

  // Build the full message context for the LLM
  const contextMessages = [
    new SystemMessage(SYSTEM_PROMPT + `\n\nCurrent salesperson: ${employeeName || 'Salesperson'}\nPhone: ${senderPhone}\nMessage type: ${messageType}${intentAnchor}`),
    ...messages,
  ];

  // Get model with current pre-bound tools
  let response;
  try {
    response = await invokeWithFallback(contextMessages, currentTools);
    response = normalizeGroqToolCalls(response);
  } catch (err) {
    console.error('[Orchestrator] Model invocation failed:', err.message);
    return {
      messages: [new AIMessage(`⚠️ I'm having trouble connecting right now. Please try again in a moment. (${err.message})`)],
    };
  }

  return { messages: [response] };
}

/**
 * Router: Decides whether to continue to tools or end the conversation.
 * If the last AI message has tool_calls, route to tool_node.
 * Otherwise, we're done — return to the user.
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
 *
 * @param {string} text           - The message text
 * @param {string} senderPhone    - The salesperson's WhatsApp number
 * @param {object} options        - Additional context
 * @param {string} options.employeeName  - Salesperson name from employee record
 * @param {string} options.messageType   - 'text' | 'image' | 'audio'
 * @param {Buffer} options.imageBuffer   - Image buffer if messageType is 'image'
 * @param {string} options.imageMimeType - MIME type of image
 *
 * @returns {string} The final reply to send back on WhatsApp
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

    // Create pre-bound tools with senderPhone locked in
    currentTools = createTools(senderPhone);
    const toolNode = new ToolNode(currentTools);

    // Build per-request graph
    const graph = new StateGraph(OrchestratorState)
      .addNode('agent', agentNode)
      .addNode('tools', toolNode)
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', shouldContinue)
      .addEdge('tools', 'agent')
      .compile();

    // Build the initial human message
    const humanMsg = new HumanMessage(text || 'Image received');

    // Run the graph
    const finalState = await graph.invoke({
      messages:      [humanMsg],
      senderPhone,
      employeeName,
      messageType,
      imageBuffer:   imageBuffer ? imageBuffer.toString('base64') : null,
      imageMimeType,
    });

    // Extract the final AI response
    const allMessages = finalState.messages;
    const lastAIMsg   = [...allMessages].reverse().find(
      (m) => m._getType?.() === 'ai' || m.constructor?.name === 'AIMessage'
    );

    const reply = lastAIMsg?.content || '✅ Done! Your activity has been logged.';
    console.log(`[Orchestrator] Reply ready (${reply.length} chars)`);
    return reply;

  } catch (err) {
    console.error('[Orchestrator] Fatal error:', err);
    return `⚠️ Something went wrong processing your message. Please try again.\n\nError: ${err.message}`;
  }
}

module.exports = { runOrchestrator };

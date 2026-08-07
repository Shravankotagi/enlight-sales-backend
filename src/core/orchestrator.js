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
 *   - Never blocks any activity due to missing customer registration
 *   - Handles multi-intent messages (visit + deal update in one message)
 *   - Maintains conversation context across turns
 *   - Falls back to Groq automatically on Gemini rate limits
 *   - All DB writes happen inside tools — fully auditable
 */

const { StateGraph, START, END, Annotation, MessagesAnnotation } = require('@langchain/langgraph');
const { ToolNode }       = require('@langchain/langgraph/prebuilt');
const { HumanMessage, SystemMessage, AIMessage } = require('@langchain/core/messages');
const { ALL_TOOLS }      = require('./tools');
const { invokeWithFallback, getModel } = require('./modelRouter');

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
- If the salesperson reports a customer requirement, product request, or inquiry (e.g. "[Company] requires 20 MT HR Coil"), ALWAYS call update_deal_stage to create/update the deal in the sales pipeline and log the inquiry! Do NOT call log_retention_followup for new product requirements.
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

// ── Nodes ─────────────────────────────────────────────────────────────────

/**
 * Agent Node: The LLM that reads messages, decides tool calls, and writes responses.
 * Re-runs after each tool_node execution until no more tool calls are needed.
 */
async function agentNode(state) {
  const { messages, senderPhone, employeeName, messageType, imageBuffer, imageMimeType } = state;

  // Build the full message context for the LLM
  const contextMessages = [
    new SystemMessage(SYSTEM_PROMPT + `\n\nCurrent salesperson: ${employeeName || 'Salesperson'}\nPhone: ${senderPhone}\nMessage type: ${messageType}`),
    ...messages,
  ];

  // Get model with all tools bound
  let response;
  try {
    response = await invokeWithFallback(contextMessages, ALL_TOOLS);
  } catch (err) {
    console.error('[Orchestrator] Model invocation failed:', err.message);
    // Return a graceful error response
    return {
      messages: [new AIMessage(`⚠️ I'm having trouble connecting right now. Please try again in a moment. (${err.message})`)],
    };
  }

  return { messages: [response] };
}

/**
 * Tool Node: Executes the tool calls made by the agent node.
 * LangGraph's built-in ToolNode handles this automatically.
 */
const toolNode = new ToolNode(ALL_TOOLS);

/**
 * Router: Decides whether to continue to tools or end the conversation.
 * If the last AI message has tool_calls, route to tool_node.
 * Otherwise, we're done — return to the user.
 */
function shouldContinue(state) {
  const lastMessage = state.messages[state.messages.length - 1];

  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    // Track which tools were used
    return 'tools';
  }

  return END;
}

// ── Build the Graph ───────────────────────────────────────────────────────

const graph = new StateGraph(OrchestratorState)
  .addNode('agent', agentNode)
  .addNode('tools', toolNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', shouldContinue)
  .addEdge('tools', 'agent')
  .compile();

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

/**
 * orchestrator.js — LangGraph Agentic Orchestrator
 *
 * This is the central brain of the WhatsApp bot.
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

// ── System Prompt — Senior Sales Operations Manager Persona ────────────────

const SYSTEM_PROMPT = `You are the Senior Sales Operations Manager & Intelligence Assistant for "Enlight Metals".

Your role is to manage and support salespersons on WhatsApp with their daily B2B sales activities (visits, deals, payments, complaints, customer onboarding) and database updates.

## Your Persona & Communication Style
- Act like an experienced, supportive, attentive human Sales Manager.
- Speak naturally in warm, professional English (or Hinglish if the user uses Hinglish).
- Celebrate wins ("Awesome job closing that deal with Mehta Engineering! 🎉").
- ALWAYS be attentive to business context: when a salesperson logs an activity with partial/incomplete information, praise them for the update AND politely ask for the missing details to complete the customer's file in the CRM!

## Missing Information Guidance (Act Like an Attentive Manager)
- If a visit/meeting is logged without quantity/tonnage or contact person details:
  "Awesome work visiting *[Customer]* in *[City]*! 🚗
   
   I've logged your visit in KRA 9 and recorded their interest in *[Products]* in our pipeline.
   
   To help us prepare the quotation and complete their profile, could you also share:
   1. Approximately how many tons (MT) of *[Products]* do they need?
   2. Did you get the contact person's name or direct mobile number on that business card?
   3. What is their target PO / delivery date?"
- If a deal/inquiry is logged without delivery location or quote deadline:
  "Got it! Added *[Customer]* to the sales pipeline! 🏗️
   What is their target delivery location and expected PO date?"

## Important Rules
- NEVER give a generic robotic 1-line reply when tool outputs are provided. Read the tool results, summarize what was saved, praise the salesperson, and ask for any missing high-value details!
- MULTI-INTENT MESSAGES: If a message contains multiple activities (e.g. a site visit AND a deal requirement), call MULTIPLE tools in parallel in the same turn!
- Keep your response structured with clean bullet points and *bold* formatting.
- Always end with a KRA dashboard confirmation line (e.g. "Updated KRA 9 Visit & KRA 1 Pipeline Dashboards! ✅").`;

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

    // Request-scoped Tool Node — returns ToolMessages to allow agent synthesis
    const inlineToolNode = async (state) => {
      const { messages } = state;
      const lastAIMsg = [...messages].reverse().find(m => m._getType?.() === 'ai' || m.constructor?.name === 'AIMessage');

      if (!lastAIMsg || !lastAIMsg.tool_calls || lastAIMsg.tool_calls.length === 0) {
        return { messages: [] };
      }

      const toolResults = [];

      for (const call of lastAIMsg.tool_calls) {
        const toolObj = TOOLS.find(t => t.name === call.name);
        if (toolObj) {
          try {
            const res = await toolObj.invoke(call.args);
            const resStr = typeof res === 'string' ? res : JSON.stringify(res);
            toolResults.push(new ToolMessage({ content: resStr, tool_call_id: call.id }));
          } catch (err) {
            console.error(`[Orchestrator] Tool ${call.name} execution error:`, err.message);
            toolResults.push(new ToolMessage({ content: `Error: ${err.message}`, tool_call_id: call.id }));
          }
        }
      }

      return { messages: toolResults };
    };

    // Build per-request graph: agent → tools → agent → END
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
    const msg = err.message || '';
    if (msg.includes('429') || msg.includes('Quota') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('All Gemini API keys')) {
      return `⏳ *Gemini Traffic Spike*\n\nGoogle Gemini rate limit reached. Please send your message again in 10 seconds.\n\n_(Tip: Add an additional Gemini API key in Railway under GEMINI_API_KEY_1 to double your quota!)_`;
    }
    return `⚠️ Something went wrong processing your message. Please try again.\n\nError: ${err.message}`;
  }
}

module.exports = { runOrchestrator };

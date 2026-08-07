/**
 * tools.js — All LangGraph Tool Definitions
 *
 * Each tool wraps an existing agent function or Supabase query.
 * The LLM (orchestrator) uses these tools to perform any action.
 * Tools are the ONLY way the LLM touches the database — no hardcoded routing.
 *
 * Tool List:
 *  1.  log_customer_visit      — KRA 9 visit logging
 *  2.  update_deal_stage       — KRA 1 deal pipeline update
 *  3.  log_payment             — KRA 5 payment collection
 *  4.  log_complaint           — KRA 8 quality complaint
 *  5.  log_retention_followup  — KRA 3 follow-up / retention
 *  6.  onboard_new_customer    — KRA 2 customer onboarding
 *  7.  query_my_data           — Unified data retrieval (payments, visits, deals, KRA, etc.)
 *  8.  get_conversation_context — Read active session + recent messages
 *  9.  process_sales_image     — PO image / deal image processing
 *  10. process_payment_image   — Receipt image processing
 */

const { tool } = require('@langchain/core/tools');
const { z }    = require('zod');

// ─── Lazy-load agents to avoid circular deps ──────────────────────────────

function getVisitAgent()     { return require('../agents/visitAgent');     }
function getSalesAgent()     { return require('../agents/salesAgent');     }
function getPaymentAgent()   { return require('../agents/paymentAgent');   }
function getComplaintAgent() { return require('../agents/complaintAgent'); }
function getRetentionAgent() { return require('../agents/retentionAgent'); }
function getCustomerAgent()  { return require('../agents/customerAgent');  }
function getQueryHandler()   { return require('../queryhandler');          }
function getSupabase()       { return require('../supabase');              }

// ─── Tool 1: Log Customer Visit (KRA 9) ───────────────────────────────────

const logCustomerVisitTool = tool(
  async ({ text, senderPhone }) => {
    try {
      const result = await getVisitAgent().processVisitMessage(text, senderPhone);
      return result;
    } catch (err) {
      return `Error logging visit: ${err.message}`;
    }
  },
  {
    name: 'log_customer_visit',
    description: `Use this tool when the salesperson reports:
- Visiting a customer site or factory
- Meeting a customer in person
- A field visit or market visit
- "Visited [Company]", "Met [Person] at [Company]"
- Discussion about products, requirements, or interests during a visit
This logs to KRA 9 and updates the customer profile.`,
    schema: z.object({
      text:        z.string().describe('The full original message from the salesperson'),
      senderPhone: z.string().describe('The WhatsApp phone number of the salesperson'),
    }),
  }
);

// ─── Tool 2: Update Deal Stage (KRA 1) ────────────────────────────────────

const updateDealStageTool = tool(
  async ({ text, senderPhone }) => {
    try {
      const result = await getSalesAgent().processSalesMessage(text, senderPhone);
      return result;
    } catch (err) {
      return `Error updating deal: ${err.message}`;
    }
  },
  {
    name: 'update_deal_stage',
    description: `Use this tool when the salesperson reports:
- Any new customer requirement, inquiry, product demand, or RFQ (e.g. "[Company] requires 20 MT HR Coil", "[Company] needs quote for 10 MT MS Plate")
- A deal being won, lost, or progressing in the pipeline
- "Deal won", "Order confirmed", "PO received", "Deal closed"
- "Lost the deal", "Customer rejected", "No order"
- Deal moving to negotiation, quotation sent, qualified lead, new inquiry
- Any sales pipeline stage update or product requirement for any customer
This creates/updates deals, logs to KRA 1 & KRA 4, and updates the sales pipeline.`,
    schema: z.object({
      text:        z.string().describe('The full original message from the salesperson'),
      senderPhone: z.string().describe('The WhatsApp phone number of the salesperson'),
    }),
  }
);

// ─── Tool 3: Log Payment (KRA 5) ──────────────────────────────────────────

const logPaymentTool = tool(
  async ({ text, senderPhone }) => {
    try {
      const result = await getPaymentAgent().processPaymentMessage(text, senderPhone);
      return result;
    } catch (err) {
      return `Error logging payment: ${err.message}`;
    }
  },
  {
    name: 'log_payment',
    description: `Use this tool when the salesperson reports:
- Receiving a payment, advance, or installment from a customer
- "Collected payment", "Received advance", "Got 5 lakh from [customer]"
- Outstanding or pending payment balances
- Full payment settlement
- "Baaki 3 lakh pending", "Payment aa gaya", "50% advance mila"
This logs to KRA 5 and updates payment_tracking.`,
    schema: z.object({
      text:        z.string().describe('The full original message from the salesperson'),
      senderPhone: z.string().describe('The WhatsApp phone number of the salesperson'),
    }),
  }
);

// ─── Tool 4: Log Complaint (KRA 8) ────────────────────────────────────────

const logComplaintTool = tool(
  async ({ text, senderPhone }) => {
    try {
      const result = await getComplaintAgent().processComplaintMessage(text, senderPhone);
      return result;
    } catch (err) {
      return `Error logging complaint: ${err.message}`;
    }
  },
  {
    name: 'log_complaint',
    description: `Use this tool when the salesperson reports:
- A customer complaint about quality, quantity, delivery, or billing
- "Customer complained about...", "Quality issue at [company]"
- Complaint being resolved or closed
- Material rejection or order discrepancy
This logs to KRA 8 and updates complaints table.`,
    schema: z.object({
      text:        z.string().describe('The full original message from the salesperson'),
      senderPhone: z.string().describe('The WhatsApp phone number of the salesperson'),
    }),
  }
);

// ─── Tool 5: Log Retention Follow-up (KRA 3) ──────────────────────────────

const logRetentionFollowupTool = tool(
  async ({ text, senderPhone }) => {
    try {
      const result = await getRetentionAgent().processRetentionMessage(text, senderPhone);
      return result;
    } catch (err) {
      return `Error logging follow-up: ${err.message}`;
    }
  },
  {
    name: 'log_retention_followup',
    description: `Use this tool ONLY when the salesperson reports:
- Explicit follow-up calls or status check-ins with an existing customer regarding past orders
- "Followed up with [customer] on old quote", "Retention call done", "Customer still considering"
- Do NOT use this for new product requirements or new inquiries — use update_deal_stage for requirements instead!
This logs to KRA 3 and updates followup_tasks.`,
    schema: z.object({
      text:        z.string().describe('The full original message from the salesperson'),
      senderPhone: z.string().describe('The WhatsApp phone number of the salesperson'),
    }),
  }
);

// ─── Tool 6: Onboard New Customer (KRA 2) ─────────────────────────────────

const onboardNewCustomerTool = tool(
  async ({ text, senderPhone }) => {
    try {
      const result = await getCustomerAgent().processCustomerMessage(text, senderPhone);
      return result;
    } catch (err) {
      return `Error onboarding customer: ${err.message}`;
    }
  },
  {
    name: 'onboard_new_customer',
    description: `Use this tool when the salesperson is:
- Adding a completely new customer to the system ("New customer [name]", "Onboard [company]")
- Providing customer details: owner, phone, city, GST
- Updating an existing customer's profile details (phone number, address, GST, contact person)
- Responding to a profile completion prompt with mobile number, owner name, or location
IMPORTANT: If the message contains profile details (phone/owner/city) but does NOT explicitly state the company name, call get_conversation_context first to get the active customer name, and include that company name in the text parameter passed to this tool (e.g. "Mehta Engineering phone 9876543210 owner MR Mehta").`,
    schema: z.object({
      text:        z.string().describe('The message or contextualized query text containing the company name and details'),
      senderPhone: z.string().describe('The WhatsApp phone number of the salesperson'),
    }),
  }
);

// ─── Tool 7: Query My Data ─────────────────────────────────────────────────

const queryMyDataTool = tool(
  async ({ text, senderPhone }) => {
    try {
      const result = await getQueryHandler().handleQuery(text, senderPhone);
      return result;
    } catch (err) {
      return `Error fetching data: ${err.message}`;
    }
  },
  {
    name: 'query_my_data',
    description: `Use this tool when the salesperson is ASKING for information, not reporting an update. Use for:
- Outstanding payments: "outstanding dikhao", "bakki list", "payment pending"
- Deal pipeline: "my deals", "pipeline status", "kitne deals hain"
- Visit history: "visit list", "kisne visit ki"
- KRA performance: "my KRA score", "performance report"
- Customer list: "mere customers", "my customer list"
- Steel rates: "aaj ka rate", "HR Coil rate"
- Any question about existing data in the system
Do NOT use this for reporting new activities — use the specific logging tools for that.`,
    schema: z.object({
      text:        z.string().describe('The query question from the salesperson'),
      senderPhone: z.string().describe('The WhatsApp phone number of the salesperson'),
    }),
  }
);

// ─── Tool 8: Get Conversation Context ─────────────────────────────────────

const getContextTool = tool(
  async ({ senderPhone }) => {
    try {
      const { getFullActiveSession } = getSupabase();
      const session = await getFullActiveSession(senderPhone);
      return JSON.stringify({
        activeCustomer:   session?.active_customer_name || null,
        lastIntent:       session?.last_intent   || null,
        sessionUpdatedAt: session?.updated_at    || null,
      });
    } catch (err) {
      return JSON.stringify({ activeCustomer: null, lastIntent: null });
    }
  },
  {
    name: 'get_conversation_context',
    description: `Use this FIRST when the salesperson's message is ambiguous or references "the customer" without naming them, or when continuing a previous conversation. Returns the currently active customer name and last known intent from the session.`,
    schema: z.object({
      senderPhone: z.string().describe('The WhatsApp phone number of the salesperson'),
    }),
  }
);

// ─── Tool 9: Process Sales PO Image ───────────────────────────────────────

const processSalesImageTool = tool(
  async ({ imageBuffer, mimeType, senderPhone }) => {
    try {
      const buf = Buffer.from(imageBuffer, 'base64');
      const result = await getSalesAgent().processSalesImage(buf, mimeType, senderPhone);
      return result;
    } catch (err) {
      return `Error processing PO image: ${err.message}`;
    }
  },
  {
    name: 'process_sales_image',
    description: `Use this when a salesperson sends a photo of a Purchase Order (PO), delivery challan, or order confirmation document. Extracts deal details and logs the win.`,
    schema: z.object({
      imageBuffer: z.string().describe('Base64-encoded image buffer'),
      mimeType:    z.string().describe('MIME type of the image e.g. image/jpeg'),
      senderPhone: z.string().describe('The WhatsApp phone number of the salesperson'),
    }),
  }
);

// ─── Tool 10: Process Payment Receipt Image ────────────────────────────────

const processPaymentImageTool = tool(
  async ({ imageBuffer, mimeType, senderPhone }) => {
    try {
      const buf = Buffer.from(imageBuffer, 'base64');
      const result = await getPaymentAgent().processPaymentImage(buf, mimeType, senderPhone);
      return result;
    } catch (err) {
      return `Error processing payment receipt: ${err.message}`;
    }
  },
  {
    name: 'process_payment_image',
    description: `Use this when a salesperson sends a photo of a payment receipt, UPI screenshot, bank transfer confirmation, or cheque image. Extracts payment details and logs to KRA 5.`,
    schema: z.object({
      imageBuffer: z.string().describe('Base64-encoded image buffer'),
      mimeType:    z.string().describe('MIME type of the image e.g. image/jpeg'),
      senderPhone: z.string().describe('The WhatsApp phone number of the salesperson'),
    }),
  }
);

// ─── Export All Tools ──────────────────────────────────────────────────────

const ALL_TOOLS = [
  logCustomerVisitTool,
  updateDealStageTool,
  logPaymentTool,
  logComplaintTool,
  logRetentionFollowupTool,
  onboardNewCustomerTool,
  queryMyDataTool,
  getContextTool,
  processSalesImageTool,
  processPaymentImageTool,
];

module.exports = {
  ALL_TOOLS,
  logCustomerVisitTool,
  updateDealStageTool,
  logPaymentTool,
  logComplaintTool,
  logRetentionFollowupTool,
  onboardNewCustomerTool,
  queryMyDataTool,
  getContextTool,
  processSalesImageTool,
  processPaymentImageTool,
};

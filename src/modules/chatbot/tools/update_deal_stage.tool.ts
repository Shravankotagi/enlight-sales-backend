import { ChatbotTool, CallerContext } from './chatbot-tool.interface';

// Lazy-load agent to avoid circular dependencies
function getSalesAgent() {
  return require('../../../agents/salesAgent');
}

export interface UpdateDealStageArgs {
  text: string;
}

export const updateDealStageTool: ChatbotTool<UpdateDealStageArgs, any> = {
  name: 'update_deal_stage',
  description:
    'Use this tool when the salesperson or user creates a new inquiry or deal, states a product requirement or quote request in conversational or layman language (e.g. "Need HR Coil 6mm, 35 MT, delivery to Nagpur by next Friday. This is for Shree Ganesh Traders company", "Require 20 MT MS Plate 10mm for Apex Steel", "Shree Ganesh Traders wants 50 MT CR Sheet"), updates deal rates/prices, updates quantities or units, adds/removes line items, updates payment terms, delivery address, delivery date, notes, confirms a Purchase Order (PO) or marks a deal as won (e.g. "PO received for the inquiry by Company 5 on 9th sept, mark that inquiry as won", "PO recevied for ID #INQ-00151B, mark it won", "Deal won for Mehta Engineering PO-9921", "Confirm PO 8821 for Supreme Steel"), marks a deal as lost with a reason, or updates deal stage. DO NOT call this tool for customer site visits (use log_customer_visit) or customer complaints (use log_complaint).',
  declaration: {
    name: 'update_deal_stage',
    description:
      'Creates a new inquiry or logs customer product requirements (even in conversational or layman phrasing like "Need HR Coil 35 MT for Shree Ganesh Traders"), updates deal rates, quantities, line items, payment terms, delivery location/date, confirms purchase orders and marks deals as won with PO number or natural customer/date reference (e.g. "PO received for the inquiry by Company 5 on 9th sept, mark that inquiry as won", "PO recevied for ID #INQ-00151B, mark it won"), or marks deals as lost with reason.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: {
          type: 'STRING',
          description:
            'The full original message or requirement text from the user',
        },
      },
      required: ['text'],
    },
  },
  roles: ['salesperson', 'sales_rep', 'manager', 'sales_manager', 'admin'],
  async execute(args: UpdateDealStageArgs, callerContext: CallerContext) {
    const senderPhone = callerContext.phone || '919619226169';
    const text = (args?.text || '').trim();

    try {
      const salesAgent = getSalesAgent();
      const result = await salesAgent.processSalesMessage(text, senderPhone);
      return {
        data: typeof result === 'string' ? result : JSON.stringify(result),
        rowCount: 1,
      };
    } catch (err: any) {
      return {
        data: `Error updating deal/inquiry: ${err.message}`,
        rowCount: 0,
      };
    }
  },
};

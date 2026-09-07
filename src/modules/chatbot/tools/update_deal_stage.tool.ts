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
    'Use this tool when the salesperson or user creates a new inquiry or deal, updates deal rates/prices, updates quantities or units, adds/removes line items, updates payment terms, delivery address, delivery date, notes, confirms a Purchase Order (PO) or marks a deal as won (e.g. "Deal won for Mehta Engineering PO-9921"), marks a deal as lost with a reason, or updates deal stage. DO NOT call this tool for customer site visits (use log_customer_visit) or customer complaints (use log_complaint).',
  declaration: {
    name: 'update_deal_stage',
    description:
      'Creates a new inquiry, updates deal rates, quantities, line items, payment terms, delivery location/date, marks deals as won with PO number, or marks deals as lost with reason.',
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

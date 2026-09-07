import { ChatbotTool, CallerContext } from './chatbot-tool.interface';

// Lazy-load agent to avoid circular dependencies
function getSalesAgent() {
  return require('../../../agents/salesAgent');
}

export interface SendQuotationArgs {
  text: string;
  email?: string;
  customer_name?: string;
  deal_id?: string;
}

export const sendQuotationTool: ChatbotTool<SendQuotationArgs, any> = {
  name: 'send_quotation',
  description:
    'Use this tool when the salesperson explicitly requests to send, email, mail, or dispatch a quotation / quote to an email address or customer (e.g. "Send quotation to client@gmail.com", "Mail quote to test@example.com", "Send quote for Inquiry #INQ-A983FC").',
  declaration: {
    name: 'send_quotation',
    description:
      'Generates and emails an official quotation PDF to the customer.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: {
          type: 'STRING',
          description: 'The full original message from the user',
        },
        email: {
          type: 'STRING',
          description:
            'The email address if mentioned e.g. client@gmail.com, else null',
        },
        customer_name: {
          type: 'STRING',
          description: 'Customer or company name if mentioned, else null',
        },
        deal_id: {
          type: 'STRING',
          description:
            'Inquiry ID if mentioned e.g. #INQ-A983FC or INQ-A983FC, else null',
        },
      },
      required: ['text'],
    },
  },
  roles: ['salesperson', 'sales_rep', 'manager', 'sales_manager', 'admin'],
  async execute(args: SendQuotationArgs, callerContext: CallerContext) {
    const senderPhone = callerContext.phone || '919619226169';
    const text = (args?.text || '').trim();

    try {
      const salesAgent = getSalesAgent();
      const result = await salesAgent.handleSendQuotationMessage(
        text,
        senderPhone,
        args.email || null,
        args.customer_name || null,
        args.deal_id || null,
      );
      return {
        data: typeof result === 'string' ? result : JSON.stringify(result),
        rowCount: 1,
      };
    } catch (err: any) {
      return {
        data: `Error sending quotation: ${err.message}`,
        rowCount: 0,
      };
    }
  },
};

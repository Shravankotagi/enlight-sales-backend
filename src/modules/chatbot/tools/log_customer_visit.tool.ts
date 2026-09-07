import { ChatbotTool, CallerContext } from './chatbot-tool.interface';

// Lazy-load agent to avoid circular dependencies
function getVisitAgent() {
  return require('../../../agents/visitAgent');
}

export interface LogCustomerVisitArgs {
  text: string;
}

export const logCustomerVisitTool: ChatbotTool<LogCustomerVisitArgs, any> = {
  name: 'log_customer_visit',
  description:
    'Use this tool when the salesperson or user reports visiting a customer site, meeting a customer in person, an office visit, a field visit or market visit. This logs to Customer Visits Card (KRA 9), updates customer profile, auto-creates prospect in recurring_customers if new, and triggers Zoho Bigin sync.',
  declaration: {
    name: 'log_customer_visit',
    description:
      'Logs a customer site visit, office meeting, or field visit with discussion remarks, person met, material requirement, visit outcome, and follow-up actions.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: {
          type: 'STRING',
          description: 'The full original visit report message from the user',
        },
      },
      required: ['text'],
    },
  },
  roles: ['salesperson', 'sales_rep', 'manager', 'sales_manager', 'admin'],
  async execute(args: LogCustomerVisitArgs, callerContext: CallerContext) {
    const senderPhone = callerContext.phone || '919619226169';
    const text = (args?.text || '').trim();

    try {
      const visitAgent = getVisitAgent();
      const result = await visitAgent.processVisitMessage(text, senderPhone);
      return {
        data: typeof result === 'string' ? result : JSON.stringify(result),
        rowCount: 1,
      };
    } catch (err: any) {
      return {
        data: `Error logging customer visit: ${err.message}`,
        rowCount: 0,
      };
    }
  },
};

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
    'ACTION TOOL: Use this tool whenever the salesperson reports or logs visiting a customer, meeting someone in person, a site visit, or an office meeting (e.g. "Met Rajesh Sharma at ABC Steel today...", "Visited Supreme Steel...", "Meeting with XYZ..."). This logs the visit to Customer Visits Card (KRA 9), auto-creates prospect in recurring_customers if new, and triggers Zoho Bigin sync.',
  declaration: {
    name: 'log_customer_visit',
    description:
      'ACTION TOOL: Logs and records a customer site visit, office meeting, or in-person discussion report with discussion remarks, person met, location, material requirement, visit outcome, and follow-up actions. Call this tool whenever the user reports having met or visited a customer (e.g. "Met [Name] at [Company]...", "Visited [Company] today...").',
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

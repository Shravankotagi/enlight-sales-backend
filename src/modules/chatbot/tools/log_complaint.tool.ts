import { ChatbotTool, CallerContext } from './chatbot-tool.interface';

// Lazy-load agent to avoid circular dependencies
function getComplaintAgent() {
  return require('../../../agents/complaintAgent');
}

export interface LogComplaintArgs {
  text: string;
}

export const logComplaintTool: ChatbotTool<LogComplaintArgs, any> = {
  name: 'log_complaint',
  description:
    'Use this tool when the user reports a customer complaint about quality, defect, rust, damage, quantity shortage, delivery, or billing, or when a complaint is resolved (e.g. "Complaint for ABC Steel resolved - replacement delivered"). Logs to Customer Complaints Card (KRA 7 & 8) and triggers Zoho Bigin sync.',
  declaration: {
    name: 'log_complaint',
    description:
      'Logs a customer quality complaint or records a complaint resolution with resolution notes and SLA status.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: {
          type: 'STRING',
          description:
            'The full original complaint report or resolution message from the user',
        },
      },
      required: ['text'],
    },
  },
  roles: ['salesperson', 'sales_rep', 'manager', 'sales_manager', 'admin'],
  async execute(args: LogComplaintArgs, callerContext: CallerContext) {
    const senderPhone = callerContext.phone || '919619226169';
    const text = (args?.text || '').trim();

    try {
      const complaintAgent = getComplaintAgent();
      const result = await complaintAgent.processComplaintMessage(
        text,
        senderPhone,
      );
      return {
        data: typeof result === 'string' ? result : JSON.stringify(result),
        rowCount: 1,
      };
    } catch (err: any) {
      return {
        data: `Error logging complaint: ${err.message}`,
        rowCount: 0,
      };
    }
  },
};

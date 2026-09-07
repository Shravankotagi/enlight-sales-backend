import { ChatbotTool, CallerContext } from './chatbot-tool.interface';

// Lazy-load agent to avoid circular dependencies
function getRetentionAgent() {
  return require('../../../agents/retentionAgent');
}

export interface LogRetentionFollowupArgs {
  text: string;
}

export const logRetentionFollowupTool: ChatbotTool<
  LogRetentionFollowupArgs,
  any
> = {
  name: 'log_retention_followup',
  description:
    'Use this ONLY for explicit follow-up calls or check-ins with existing customers on past orders or reorders. Do NOT use for new requirements (use update_deal_stage instead). Logs to Customer Retention Card (KRA 3).',
  declaration: {
    name: 'log_retention_followup',
    description:
      'Logs a customer retention follow-up call or check-in on past orders and schedules next follow-up date.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: {
          type: 'STRING',
          description: 'The follow-up message text from the user',
        },
      },
      required: ['text'],
    },
  },
  roles: ['salesperson', 'sales_rep', 'manager', 'sales_manager', 'admin'],
  async execute(args: LogRetentionFollowupArgs, callerContext: CallerContext) {
    const senderPhone = callerContext.phone || '919619226169';
    const text = (args?.text || '').trim();

    try {
      const retentionAgent = getRetentionAgent();
      const result = await retentionAgent.processRetentionMessage(
        text,
        senderPhone,
      );
      return {
        data: typeof result === 'string' ? result : JSON.stringify(result),
        rowCount: 1,
      };
    } catch (err: any) {
      return {
        data: `Error logging retention follow-up: ${err.message}`,
        rowCount: 0,
      };
    }
  },
};

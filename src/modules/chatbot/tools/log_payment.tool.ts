import { ChatbotTool, CallerContext } from './chatbot-tool.interface';

// Lazy-load agent to avoid circular dependencies
function getPaymentAgent() {
  return require('../../../agents/paymentAgent');
}

export interface LogPaymentArgs {
  text: string;
}

export const logPaymentTool: ChatbotTool<LogPaymentArgs, any> = {
  name: 'log_payment',
  description:
    'Use this tool when the user reports receiving a payment, advance, installment, cheque, NEFT, RTGS, or UPI payment from a customer. Logs to Payment Collection Card (KRA 5) and triggers Zoho Bigin sync.',
  declaration: {
    name: 'log_payment',
    description:
      'Logs customer payment received (advance, installment, or full settlement) and payment mode.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: {
          type: 'STRING',
          description: 'The full original payment message from the user',
        },
      },
      required: ['text'],
    },
  },
  roles: ['salesperson', 'sales_rep', 'manager', 'sales_manager', 'admin'],
  async execute(args: LogPaymentArgs, callerContext: CallerContext) {
    const senderPhone = callerContext.phone || '919619226169';
    const text = (args?.text || '').trim();

    try {
      const paymentAgent = getPaymentAgent();
      const result = await paymentAgent.processPaymentMessage(
        text,
        senderPhone,
      );
      return {
        data: typeof result === 'string' ? result : JSON.stringify(result),
        rowCount: 1,
      };
    } catch (err: any) {
      return {
        data: `Error logging payment: ${err.message}`,
        rowCount: 0,
      };
    }
  },
};

import { ChatbotTool, CallerContext } from './chatbot-tool.interface';

// Lazy-load agent to avoid circular dependencies
function getCustomerAgent() {
  return require('../../../agents/customerAgent');
}

export interface OnboardNewCustomerArgs {
  text: string;
}

export const onboardNewCustomerTool: ChatbotTool<OnboardNewCustomerArgs, any> =
  {
    name: 'onboard_new_customer',
    description:
      'Use this tool when adding or onboarding a new customer or prospect to the system with company name, contact person, phone, GST number, address, or city. Performs duplicate checks and logs to New Customer Acquisition Card (KRA 2).',
    declaration: {
      name: 'onboard_new_customer',
      description:
        'Onboards a new customer profile with company name, contact person, phone, GST, and city with duplicate check.',
      parameters: {
        type: 'OBJECT',
        properties: {
          text: {
            type: 'STRING',
            description:
              'The customer details and onboarding message text from the user',
          },
        },
        required: ['text'],
      },
    },
    roles: ['salesperson', 'sales_rep', 'manager', 'sales_manager', 'admin'],
    async execute(args: OnboardNewCustomerArgs, callerContext: CallerContext) {
      const senderPhone = callerContext.phone || '919619226169';
      const text = (args?.text || '').trim();

      try {
        const customerAgent = getCustomerAgent();
        const result = await customerAgent.processCustomerMessage(
          text,
          senderPhone,
        );
        return {
          data: typeof result === 'string' ? result : JSON.stringify(result),
          rowCount: 1,
        };
      } catch (err: any) {
        return {
          data: `Error onboarding customer: ${err.message}`,
          rowCount: 0,
        };
      }
    },
  };

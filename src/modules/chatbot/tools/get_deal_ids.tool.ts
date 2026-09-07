import { ChatbotTool, CallerContext } from './chatbot-tool.interface';

function getQueryHandler() {
  return require('../../../queryhandler');
}

export interface GetDealIdsArgs {
  company_name?: string | null;
  text?: string;
}

export const getDealIdsTool: ChatbotTool<GetDealIdsArgs, any> = {
  name: 'get_deal_ids',
  description:
    'Use this tool when the salesperson asks for the Inquiry ID(s) or inquiry code(s) for a company (e.g. "What is the inquiry ID for Radhe Ispat?", "Inquiry ID for Apex Steel", "Give me inquiry ID", "Inquiry ID", "Deal ID"). If company name is not provided in message, pass company_name as null.',
  declaration: {
    name: 'get_deal_ids',
    description:
      'Fetches Inquiry IDs (#INQ-XXXXXX) for a specific customer or company.',
    parameters: {
      type: 'OBJECT',
      properties: {
        company_name: {
          type: 'STRING',
          description: 'The customer/company name if mentioned, else null',
        },
        text: {
          type: 'STRING',
          description: 'The user query text',
        },
      },
    },
  },
  roles: ['salesperson', 'sales_rep', 'manager', 'sales_manager', 'admin'],
  async execute(args: GetDealIdsArgs, callerContext: CallerContext) {
    const senderPhone = callerContext.phone || '919619226169';

    try {
      const qh = getQueryHandler();
      const result = await qh.getDealIdsForCompany(
        senderPhone,
        args.text || '',
        args.company_name || null,
      );
      return {
        data: typeof result === 'string' ? result : JSON.stringify(result),
        rowCount: 1,
      };
    } catch (err: any) {
      return {
        data: `Error fetching deal IDs: ${err.message}`,
        rowCount: 0,
      };
    }
  },
};

import { ChatbotTool, CallerContext } from './chatbot-tool.interface';

function getSupabaseHelper() {
  return require('../../../supabase');
}

export interface UpdateCustomerProfileArgs {
  customer_name?: string;
  order_frequency_days?: number;
  contact_person?: string;
  phone?: string;
  gst?: string;
  address_or_city?: string;
  assigned_salesperson?: string;
  text?: string;
}

export const updateCustomerProfileTool: ChatbotTool<
  UpdateCustomerProfileArgs,
  any
> = {
  name: 'update_customer_profile',
  description:
    'Use this tool when updating an existing customer\'s order frequency (e.g. "Change Supreme Steel order frequency to 45 days"), contact details (phone, contact person, GST, city/address), or reassigning a customer to a salesperson. Finds the customer across the database and updates their record in place with zero duplicates.',
  declaration: {
    name: 'update_customer_profile',
    description:
      'Updates customer order frequency in days, contact person, phone, GST, address, or assigned salesperson.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: {
          type: 'STRING',
          description:
            'The name of the company or customer to update. If omitted, pass null.',
        },
        order_frequency_days: {
          type: 'NUMBER',
          description:
            'New order frequency in number of days (e.g. 45, 30, 60)',
        },
        contact_person: {
          type: 'STRING',
          description: 'New contact person / owner name',
        },
        phone: {
          type: 'STRING',
          description: 'New phone or mobile number',
        },
        gst: {
          type: 'STRING',
          description: 'New GST number',
        },
        address_or_city: {
          type: 'STRING',
          description: 'New address or city/location',
        },
        assigned_salesperson: {
          type: 'STRING',
          description:
            'Salesperson name to reassign or associate with this customer',
        },
        text: {
          type: 'STRING',
          description: 'The original user message text',
        },
      },
    },
  },
  roles: ['salesperson', 'sales_rep', 'manager', 'sales_manager', 'admin'],
  async execute(args: UpdateCustomerProfileArgs, callerContext: CallerContext) {
    const senderPhone = callerContext.phone || '919619226169';

    try {
      const { updateCustomerProfileRecord } = getSupabaseHelper();
      const res = await updateCustomerProfileRecord(
        senderPhone,
        args.customer_name || null,
        {
          order_frequency_days: args.order_frequency_days,
          contact_person: args.contact_person,
          phone: args.phone,
          gst: args.gst,
          address_or_city: args.address_or_city,
          assigned_salesperson: args.assigned_salesperson,
        },
      );
      return {
        data:
          res?.message || (typeof res === 'string' ? res : JSON.stringify(res)),
        rowCount: 1,
      };
    } catch (err: any) {
      return {
        data: `Error updating customer profile: ${err.message}`,
        rowCount: 0,
      };
    }
  },
};

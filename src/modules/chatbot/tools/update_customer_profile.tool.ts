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

export function parseCustomerProfileUpdateArgs(
  args: UpdateCustomerProfileArgs,
): {
  customer_name: string | null;
  order_frequency_days?: number;
  contact_person?: string;
  phone?: string;
  gst?: string;
  address_or_city?: string;
  assigned_salesperson?: string;
} {
  const text = (args.text || '').trim();
  let customer_name = args.customer_name ? args.customer_name.trim() : '';
  let contact_person = args.contact_person ? args.contact_person.trim() : '';
  let phone = args.phone ? args.phone.trim() : '';
  let gst = args.gst ? args.gst.trim() : '';
  let address_or_city = args.address_or_city ? args.address_or_city.trim() : '';
  let assigned_salesperson = args.assigned_salesperson
    ? args.assigned_salesperson.trim()
    : '';
  let order_frequency_days =
    args.order_frequency_days != null
      ? Number(args.order_frequency_days)
      : undefined;

  // Clean customer_name if provided
  if (customer_name) {
    customer_name = customer_name
      .replace(/^(?:for|to|of|the|an?)\s+/i, '')
      .replace(/\s+(?:customer|client|account|company)$/i, '')
      .trim();
  }

  if (text) {
    // 0. High-Confidence Pattern: "Assign <Company> to salesperson/rep <Person>"
    const assignPatternMatch = text.match(
      /(?:assign|reassign)\s+([a-zA-Z0-9\s&.-]+?)\s+to\s+(?:salesperson|sales\s+rep|rep)?\s*([a-zA-Z\s.]+?)(?=(?:\s*,|\s+and|$|\n))/i,
    );
    if (assignPatternMatch) {
      if (!customer_name) {
        customer_name = assignPatternMatch[1].trim();
      }
      if (!assigned_salesperson) {
        assigned_salesperson = assignPatternMatch[2].trim();
      }
    }

    // 1. Phone extraction
    if (!phone) {
      const phoneLabelMatch = text.match(
        /(?:number|phone|mobile|contact\s*no|contact\s*number|cell)\s*(?:is|to|=|:|-)?\s*([+0-9\s\-]{10,15})/i,
      );
      if (phoneLabelMatch) {
        const digits = phoneLabelMatch[1].replace(/\D/g, '');
        if (digits.length >= 10) phone = digits.slice(-10);
      } else {
        const phoneRegex = /\b(?:(?:\+?91[\-\s]?)?[6-9]\d{9})\b/;
        const standaloneMatch = text.match(phoneRegex);
        if (standaloneMatch) {
          phone = standaloneMatch[0].replace(/\D/g, '').slice(-10);
        }
      }
    }

    // 2. Order frequency extraction
    if (order_frequency_days == null || isNaN(order_frequency_days)) {
      const freqMatch =
        text.match(
          /(?:order\s+frequency|frequency|order\s+cycle|cycle|cadence)\s*(?:for\s+[a-zA-Z0-9\s&.-]+?\s+)?(?:is|to|of|as|=|:|-)?\s*(\d+)\s*(?:days?|d)?/i,
        ) ||
        text.match(
          /(?:set|update|change)\s+[a-zA-Z0-9\s&.-]+\s+order\s+frequency\s+to\s+(\d+)/i,
        );
      if (freqMatch) {
        order_frequency_days = parseInt(freqMatch[1], 10);
      } else {
        const everyDaysMatch = text.match(/(?:every|each)\s+(\d+)\s+days/i);
        if (everyDaysMatch) {
          order_frequency_days = parseInt(everyDaysMatch[1], 10);
        }
      }
    }

    // 3. GST extraction
    if (!gst) {
      const gstMatch =
        text.match(
          /\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})\b/i,
        ) || text.match(/(?:gst|gstin)\s*[-:=]?\s*([0-9A-Za-z]+)/i);
      if (gstMatch) {
        gst = gstMatch[1].trim().toUpperCase();
      }
    }

    // 4. Assigned salesperson extraction
    if (!assigned_salesperson) {
      const repMatch = text.match(
        /(?:to\s+salesperson|to\s+sales\s+rep|to\s+rep|salesperson|sales\s+rep|rep)\s*(?:is|to|=|:|-)?\s*([a-zA-Z\s]+?)(?=(?:\s*,|\s+and|$|\n))/i,
      );
      if (repMatch) {
        assigned_salesperson = repMatch[1]
          .replace(/^(?:salesperson|sales\s+rep|rep)\s+/i, '')
          .trim();
      }
    }

    // 5. Contact person extraction
    if (!contact_person) {
      // Form: name - ramesh / person name: ramesh / contact person: ramesh
      const nameLabelMatch = text.match(
        /(?:person\s+name|contact\s+person|contact\s+name|name)\s*[-:]\s*([a-zA-Z\s.]+?)(?=(?:\s*,|\s+and|\s+with|\s+number|\s+phone|\s+mobile|\s+for|\s+gst|$|\n))/i,
      );
      if (nameLabelMatch) {
        contact_person = nameLabelMatch[1].trim();
      } else {
        // Form: contact person for <Company> to <Person>
        const personToMatch = text.match(
          /(?:contact\s+person|person\s+name|contact|person)\s+(?:for\s+[a-zA-Z0-9\s&.-]+?\s+)?to\s+([a-zA-Z\s.]+?)(?=(?:\s*,|\s+and|\s+with|\s+number|\s+phone|\s+mobile|\s+for|\s+gst|$|\n))/i,
        );
        if (personToMatch) {
          contact_person = personToMatch[1].trim();
        } else {
          // Form: set contact person <Person> for <Company>
          const personForMatch = text.match(
            /(?:contact\s+person|person\s+name|contact|person)\s+([a-zA-Z\s.]+?)\s+for\s+[a-zA-Z0-9\s&.-]+/i,
          );
          if (personForMatch) {
            contact_person = personForMatch[1].trim();
          }
        }
      }
    }

    // 6. Customer name extraction if not provided
    if (!customer_name) {
      // Form: "for/of <Company> customer/client" or "for/of <Company> to <Value>" or "for/of <Company>,"
      const forToMatch = text.match(
        /(?:for|of)\s+([a-zA-Z0-9\s&.-]+?)(?:\s+customer|\s+client|\s+account|\s+company|\s+to\b|\s+is\b|,|\s+name|\s+number|\s+phone|\s+person|\s+gst|\s+frequency|\s+cycle|$|\n)/i,
      );
      if (forToMatch) {
        const extracted = forToMatch[1]
          .replace(/^(?:the|an?)\s+/i, '')
          .replace(/\s+(?:customer|client|account|company)$/i, '')
          .trim();
        if (
          extracted &&
          !/^(contact|person|phone|number|gst|gstin|order\s+frequency|frequency|address|location|city)$/i.test(
            extracted,
          )
        ) {
          customer_name = extracted;
        }
      }

      // Form: "Set/Update <Company> <Field> to <Value>" (e.g. "Set Supreme Steel order frequency to 45 days")
      if (!customer_name) {
        const actionCompMatch = text.match(
          /^(?:set|update|change|edit|modify|add)\s+(?:the\s+)?([a-zA-Z0-9\s&.-]+?)\s+(?:order\s+frequency|frequency|contact\s+person|contact\s+name|person\s+name|gst|gstin|address|location|city|phone|number|contact)\s+(?:to|is|=|-|:|as|\d)/i,
        );
        if (actionCompMatch) {
          const extracted = actionCompMatch[1]
            .replace(/^(?:the|an?)\s+/i, '')
            .replace(/\s+(?:customer|client|account|company)$/i, '')
            .trim();
          if (
            extracted &&
            !/^(contact|person|phone|number|gst|gstin|order\s+frequency|frequency|address|location|city|person\s+name|contact\s+person|contact\s+name|contact\s+number)$/i.test(
              extracted,
            )
          ) {
            customer_name = extracted;
          }
        }
      }

      // Form: "<Company> customer"
      if (!customer_name) {
        const custSuffixMatch = text.match(
          /([a-zA-Z0-9\s&.-]+?)\s+(?:customer|client|account)\b/i,
        );
        if (custSuffixMatch) {
          customer_name = custSuffixMatch[1]
            .replace(
              /^(?:add|update|set|change|edit|modify|attach|save|for|to|of)\s+/i,
              '',
            )
            .replace(
              /(?:person\s+name|contact\s+person|contact\s+number|number|phone|and)\s*$/i,
              '',
            )
            .trim();
        }
      }
    }

    // 7. Address / City extraction
    if (!address_or_city) {
      const cityMatch = text.match(
        /(?:address|location|city)\s*[-:=]?\s*(?:to\s+)?([a-zA-Z0-9\s,.-]+?)(?=(?:\s*,|\s+and|\s+gst|\s+phone|\s+name|$|\n))/i,
      );
      if (cityMatch) {
        address_or_city = cityMatch[1].trim();
      }
    }
  }

  // Final cleanup on customer_name
  if (customer_name) {
    customer_name = customer_name
      .replace(/[`'"]/g, '')
      .replace(/^(?:for|to|of|the|an?)\s+/i, '')
      .replace(/\s+(?:customer|client|account|company)$/i, '')
      .trim();
  }

  return {
    customer_name: customer_name || null,
    order_frequency_days:
      order_frequency_days && !isNaN(order_frequency_days)
        ? order_frequency_days
        : undefined,
    contact_person: contact_person || undefined,
    phone: phone || undefined,
    gst: gst || undefined,
    address_or_city: address_or_city || undefined,
    assigned_salesperson: assigned_salesperson || undefined,
  };
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
      const parsedParams = parseCustomerProfileUpdateArgs(args);
      const { updateCustomerProfileRecord } = getSupabaseHelper();
      const res = await updateCustomerProfileRecord(
        senderPhone,
        parsedParams.customer_name || null,
        {
          order_frequency_days: parsedParams.order_frequency_days,
          contact_person: parsedParams.contact_person,
          phone: parsedParams.phone,
          gst: parsedParams.gst,
          address_or_city: parsedParams.address_or_city,
          assigned_salesperson: parsedParams.assigned_salesperson,
        },
      );
      return {
        data:
          res?.message || (typeof res === 'string' ? res : JSON.stringify(res)),
        rowCount: res?.success ? 1 : 0,
      };
    } catch (err: any) {
      return {
        data: `Error updating customer profile: ${err.message}`,
        rowCount: 0,
      };
    }
  },
};

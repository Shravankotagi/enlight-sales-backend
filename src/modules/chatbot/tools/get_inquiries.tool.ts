import {
  ChatbotTool,
  CallerContext,
  getSubordinateSalespersons,
  isManagerRole,
  isSalespersonRole,
} from './chatbot-tool.interface';

export const getInquiriesTool: ChatbotTool = {
  name: 'get_inquiries',
  description:
    'Fetches incoming inquiries, customer requirements, raw WhatsApp messages, and extracted SKU/quantity details from the inquiries table, scoped strictly by caller role and ordered newest-first.',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_inquiries',
    description:
      'Retrieves incoming customer inquiries and raw WhatsApp messages from the inquiries table. Scoped to the caller role, ordered newest-first (most recent inquiry is first).',
    parameters: {
      type: 'OBJECT',
      properties: {
        status_filter: {
          type: 'STRING',
          description:
            'Optional filter by inquiry status. Valid values: "all", "pending", "review", "confirmed", "processed". Default is "all".',
        },
        limit: {
          type: 'INTEGER',
          description:
            'Maximum number of inquiries to return (default: 20, max: 100).',
        },
        customer_name_search: {
          type: 'STRING',
          description: 'Optional search term for customer or company name.',
        },
        recent_only: {
          type: 'BOOLEAN',
          description: 'If true, returns only the top 5 most recent inquiries.',
        },
      },
    },
  },
  async execute(args: any, callerContext: CallerContext, supabaseAdmin: any) {
    const rawStatus = (args?.status_filter || '').toLowerCase().trim();
    const limit = args?.recent_only
      ? 5
      : Math.min(Math.max(Number(args?.limit) || 20, 1), 100);
    const searchName = (args?.customer_name_search || '').trim();

    let query = supabaseAdmin
      .from('inquiries')
      .select(
        'id, sender_name, sender_phone, customer_name, customer_phone, raw_text, inquiry_type, status, source_channel, overall_confidence, ai_extraction_json, created_at, salesperson_phone, media_urls',
      )
      .order('created_at', { ascending: false });

    // 1. Role-based scoping (Layer 1 enforcement)
    if (isSalespersonRole(callerContext.role)) {
      const rawPhone = callerContext.phone || '';
      const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);

      if (cleanPhone) {
        query = query.or(
          `salesperson_phone.ilike.%${cleanPhone}%,sender_phone.ilike.%${cleanPhone}%`,
        );
      }
    } else if (isManagerRole(callerContext.role)) {
      const { phoneSuffixes } = await getSubordinateSalespersons(
        callerContext,
        supabaseAdmin,
      );

      if (phoneSuffixes.length === 0) {
        return { data: [], rowCount: 0 };
      }

      const conditions = phoneSuffixes.map(
        (p) => `salesperson_phone.ilike.%${p}%,sender_phone.ilike.%${p}%`,
      );
      query = query.or(conditions.join(','));
    }
    // Admin role receives unfiltered data

    // 2. Status filter
    if (rawStatus && rawStatus !== 'all') {
      if (rawStatus === 'new') {
        query = query.in('status', ['pending', 'review', 'auto_created']);
      } else {
        query = query.ilike('status', `%${rawStatus}%`);
      }
    }

    // 3. Customer name search
    if (searchName) {
      query = query.or(
        `sender_name.ilike.%${searchName}%,customer_name.ilike.%${searchName}%`,
      );
    }

    query = query.limit(limit);

    const { data, error } = await query;
    if (error) {
      throw new Error(`get_inquiries error: ${error.message}`);
    }

    const rawList = data || [];

    // Format clean structured representation with extracted fields and original message
    const formattedInquiries = rawList.map((inq: any) => {
      const aiJson = (inq.ai_extraction_json as any) || {};
      const resolvedCustomerName =
        inq.customer_name ||
        aiJson.customer_name ||
        aiJson.customer?.name ||
        aiJson.companyName ||
        inq.sender_name ||
        'Customer Inquiry';

      const resolvedCustomerPhone =
        inq.customer_phone ||
        aiJson.customer_phone ||
        aiJson.customer?.phone ||
        inq.sender_phone ||
        '';

      const lineItems =
        aiJson.line_items || aiJson.lineItems || aiJson.items || [];

      return {
        inquiry_id: inq.id,
        received_at: inq.created_at,
        customer_name: resolvedCustomerName,
        customer_phone: resolvedCustomerPhone,
        salesperson_phone: inq.salesperson_phone || inq.sender_phone || '',
        source_channel: inq.source_channel || 'whatsapp',
        status: inq.status || 'review',
        inquiry_type: inq.inquiry_type || 'Product Requirement',
        overall_confidence: inq.overall_confidence || 0.95,
        original_whatsapp_message: inq.raw_text || '',
        extracted_line_items: lineItems.map((li: any) => ({
          description:
            li.sku_text || li.description || li.product || 'Material',
          specs: li.dimensions || li.specs || null,
          quantity_mt: Number(li.quantity) || Number(li.quantity_tons) || 0,
          unit: li.unit || 'MT',
          rate_per_mt: Number(li.rate) || 0,
          amount: Number(li.amount) || 0,
        })),
        delivery_location:
          aiJson.delivery_location || aiJson.deliveryLocation || null,
        payment_terms: aiJson.payment_terms || aiJson.paymentTerms || null,
      };
    });

    return {
      data: formattedInquiries,
      rowCount: formattedInquiries.length,
    };
  },
};

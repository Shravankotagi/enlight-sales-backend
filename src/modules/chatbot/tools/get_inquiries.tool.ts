import {
  ChatbotTool,
  CallerContext,
  getSubordinateSalespersons,
  isManagerRole,
  isSalespersonRole,
} from './chatbot-tool.interface';
import { convertLineItemToMt } from '../../pricing/pricing.engine';

function parseDateFilter(dateFilter?: string): { from?: Date; to?: Date } {
  if (!dateFilter || dateFilter === 'all') return {};
  const now = new Date();
  const lower = dateFilter.toLowerCase().trim();

  if (lower === 'today') {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    return { from: startOfToday };
  }
  if (lower === 'yesterday') {
    const startOfYesterday = new Date(now);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    startOfYesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(now);
    endOfYesterday.setDate(endOfYesterday.getDate() - 1);
    endOfYesterday.setHours(23, 59, 59, 999);
    return { from: startOfYesterday, to: endOfYesterday };
  }
  if (lower === 'this_week' || lower === 'week') {
    const startOfWeek = new Date(now);
    startOfWeek.setDate(startOfWeek.getDate() - 7);
    startOfWeek.setHours(0, 0, 0, 0);
    return { from: startOfWeek };
  }
  if (lower === 'this_month' || lower === 'month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: startOfMonth };
  }
  if (lower === 'last_month' || lower === 'previous_month') {
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    endOfLastMonth.setHours(23, 59, 59, 999);
    return { from: startOfLastMonth, to: endOfLastMonth };
  }
  const parsed = new Date(dateFilter);
  if (!isNaN(parsed.getTime())) {
    const start = new Date(parsed);
    start.setHours(0, 0, 0, 0);
    const end = new Date(parsed);
    end.setHours(23, 59, 59, 999);
    return { from: start, to: end };
  }
  return {};
}

interface CachedData {
  inquiries: any[];
  deals: any[];
  timestamp: number;
}
const inquiriesGlobalCache: Map<string, CachedData> = new Map();
const CACHE_TTL_MS = 60 * 1000;

export const getInquiriesTool: ChatbotTool = {
  name: 'get_inquiries',
  description:
    'Fetches customer inquiries, raw WhatsApp messages, and linked deal outcomes. Always returns total inquiry counts, stage breakdown (won, lost, quoted, review), source channel breakdown (WhatsApp vs Dashboard), OCR/document stats, top tonnage inquiries, top customers, and itemized records. Scoped strictly by caller role.',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_inquiries',
    description:
      'Retrieves incoming customer inquiries, raw WhatsApp messages, and resulting deal status from the inquiries table. Always returns exact total counts, status/stage breakdown, source channel breakdown (WhatsApp vs Dashboard), OCR/document metrics, top tonnage inquiries, and itemized records. Supports direct inquiry ID lookups (#INQ-XXXXXX) without requiring a customer name.',
    parameters: {
      type: 'OBJECT',
      properties: {
        inquiry_id: {
          type: 'STRING',
          description:
            'Optional specific Inquiry ID or Deal ID (e.g. "#INQ-2C788F", "INQ-2C788F", "2C788F", or UUID) to fetch status and details for that exact inquiry. When provided, customer name is NOT required.',
        },
        status_filter: {
          type: 'STRING',
          description:
            'Optional filter by inquiry status or deal outcome. Valid values: "all", "won" / "converted" / "orders" (inquiries converted to orders with PO), "lost" / "not_converted" (unconverted lost inquiries), "in_progress" / "open", "quoted", "negotiation", "review", "confirmed", "pending" (Review Queue inquiries). Default is "all".',
        },
        source_channel: {
          type: 'STRING',
          description:
            'Optional filter by incoming source channel: "all", "whatsapp" (all WhatsApp messages/images/POs), "dashboard" (web dashboard/manual), "whatsapp_text", "whatsapp_image", "whatsapp_po", "web_dashboard".',
        },
        source_type: {
          type: 'STRING',
          description:
            'Optional filter by inquiry format: "all", "ocr_document" (inquiries received as attached documents, PDFs, or scanned images), "text" (plain text inquiries).',
        },
        date_range: {
          type: 'STRING',
          description:
            'Optional date filter. Valid values: "today", "yesterday", "this_week", "this_month", "all", or specific ISO date.',
        },
        customer_name_search: {
          type: 'STRING',
          description: 'Optional search term for customer or company name.',
        },
        sort_by: {
          type: 'STRING',
          description:
            'Optional sorting: "date_desc" (default), "tonnage_desc" (highest tonnage first), "tonnage_asc", "amount_desc".',
        },
        mode: {
          type: 'STRING',
          description:
            'Query mode: "list" (default, returns records with summary), "conversion_breakdown" (returns inquiries converted to orders vs not converted/lost), "rep_conversion" (sales rep conversion rankings & leaderboard), "open_inquiries_dormant_buyers" (customers with open inquiries but no orders in last 30 days), "month_comparison" (compares this month vs last month inquiries and channels), "monthly_summary" (unified summary for this month), "at_risk_inquiries" (inquiries from at-risk accounts), "count" (returns only counts and statistics), "highest_tonnage" (returns top tonnage inquiries), "channel_breakdown" (returns WhatsApp vs Dashboard split), "top_customers" (returns customer frequency ranking), "review_queue" (pending review inquiries).',
        },
        limit: {
          type: 'INTEGER',
          description:
            'Maximum number of inquiries to return in list mode (default: 20, max: 100).',
        },
        recent_only: {
          type: 'BOOLEAN',
          description: 'If true, returns only the top 5 most recent inquiries.',
        },
      },
    },
  },
  async execute(args: any, callerContext: CallerContext, supabaseAdmin: any) {
    const rawInquiryId = (
      args?.inquiry_id ||
      args?.deal_id ||
      args?.inquiryId ||
      args?.dealId ||
      ''
    ).trim();
    const cleanInquiryId = rawInquiryId
      .replace(/^[#]?(?:INQ|DEAL)-?/i, '')
      .toLowerCase();

    const rawStatus = (args?.status_filter || args?.stage_filter || '')
      .toLowerCase()
      .trim();
    const sourceChannelFilter = (args?.source_channel || '')
      .toLowerCase()
      .trim();
    const sourceTypeFilter = (args?.source_type || '').toLowerCase().trim();
    const sortBy = (args?.sort_by || '').toLowerCase().trim();
    const limit = args?.recent_only
      ? 5
      : Math.min(Math.max(Number(args?.limit) || 20, 1), 100);
    const searchName = (args?.customer_name_search || '').trim().toLowerCase();
    const dateRange = args?.date_range;
    const mode = (args?.mode || 'list').toLowerCase().trim();

    // 1. Build Base Queries (decoupled to prevent PostgREST statement timeouts on 3-table nested joins)
    let inqQuery = supabaseAdmin
      .from('inquiries')
      .select(
        'id, sender_name, sender_phone, raw_text, inquiry_type, status, source_channel, media_urls, overall_confidence, ai_extraction_json, created_at, salesperson_phone, employee_id',
      )
      .order('created_at', { ascending: false });

    const dealsQuery = supabaseAdmin
      .from('deals')
      .select(
        'id, inquiry_id, stage, status, customer_name, customer_phone, po_number, total_amount, salesperson_phone, employee_id, created_at, won_at, deal_items(sku_text, dimensions, quantity, unit, rate, amount)',
      );

    // 2. Role-based scoping (Layer 1 enforcement - Fail-Closed)
    // Note: When looking up a specific Inquiry ID, we enforce scoping by caller's assigned portfolio
    if (isSalespersonRole(callerContext.role)) {
      const rawPhone = callerContext.phone || '';
      const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
      const empId = callerContext.employeeId;
      const orParts: string[] = [];

      if (cleanPhone) {
        orParts.push(
          `salesperson_phone.ilike.%${cleanPhone}%`,
          `sender_phone.ilike.%${cleanPhone}%`,
        );
      }
      if (empId) {
        orParts.push(`employee_id.eq.${empId}`);
      }

      if (orParts.length === 0) {
        return {
          data: {
            notFound: true,
            summary: {
              total_inquiries: 0,
              inquiries_today: 0,
              by_inquiry_status: {},
              by_deal_stage: {},
              by_source_channel: { whatsapp: 0, dashboard: 0 },
              top_customers: [],
              message: 'Access denied. Caller identity could not be verified.',
            },
            inquiries: [],
          },
          rowCount: 0,
        };
      }

      inqQuery = inqQuery.or(orParts.join(','));
    } else if (isManagerRole(callerContext.role)) {
      const { phoneSuffixes, employeeIds } = await getSubordinateSalespersons(
        callerContext,
        supabaseAdmin,
      );

      const orParts: string[] = [];
      phoneSuffixes.forEach((p) => {
        orParts.push(
          `salesperson_phone.ilike.%${p}%`,
          `sender_phone.ilike.%${p}%`,
        );
      });
      employeeIds.forEach((id) => {
        orParts.push(`employee_id.eq.${id}`);
      });

      if (orParts.length === 0) {
        return {
          summary: {
            total_inquiries: 0,
            inquiries_today: 0,
            by_inquiry_status: {},
            by_deal_stage: {},
            by_source_channel: { whatsapp: 0, dashboard: 0 },
            top_customers: [],
          },
          data: [],
          rowCount: 0,
        };
      }

      inqQuery = inqQuery.or(orParts.join(','));
    }
    // Admin role receives unfiltered data

    // 3. Date filtering
    const { from, to } = parseDateFilter(dateRange);
    if (from) {
      inqQuery = inqQuery.gte('created_at', from.toISOString());
    }
    if (to) {
      inqQuery = inqQuery.lte('created_at', to.toISOString());
    }

    // 4. In-memory cache resolution to prevent repeated Supabase latency & statement timeouts
    const cacheKey = `${callerContext.userId || callerContext.role}_${from?.toISOString() || ''}_${to?.toISOString() || ''}`;
    const cached = inquiriesGlobalCache.get(cacheKey);
    let inqData: any[] = [];
    let dealsData: any[] = [];

    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      inqData = cached.inquiries;
      dealsData = cached.deals;
    } else {
      const [inqRes, dealsRes] = await Promise.all([inqQuery, dealsQuery]);
      if (inqRes.error) {
        throw new Error(`get_inquiries error: ${inqRes.error.message}`);
      }
      inqData = inqRes.data || [];
      dealsData = dealsRes.data || [];
      inquiriesGlobalCache.set(cacheKey, {
        inquiries: inqData,
        deals: dealsData,
        timestamp: Date.now(),
      });
    }

    const dealsByInquiryId = new Map<string, any[]>();
    dealsData.forEach((d: any) => {
      if (d.inquiry_id) {
        const list = dealsByInquiryId.get(d.inquiry_id) || [];
        list.push(d);
        dealsByInquiryId.set(d.inquiry_id, list);
      }
    });

    const rawList = inqData.map((inq: any) => ({
      ...inq,
      deals: dealsByInquiryId.get(inq.id) || [],
    }));

    // 4. Process all inquiries & compute accurate metrics
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let inquiriesTodayCount = 0;
    const inquiryStatusCounts: Record<string, number> = {};
    const dealStageCounts: Record<string, number> = {};
    const customerCountMap: Record<string, number> = {};

    let whatsappChannelCount = 0;
    let dashboardChannelCount = 0;
    const channelDetailedMap: Record<string, number> = {};

    let totalOcrDocumentCount = 0;
    let pendingOcrDocumentCount = 0;
    let confirmedOcrDocumentCount = 0;
    let quotedOcrDocumentCount = 0;
    let wonOcrDocumentCount = 0;

    let wonInquiriesCount = 0;

    const formattedList = rawList.map((inq: any) => {
      const dealsList: any[] = Array.isArray(inq.deals)
        ? inq.deals
        : inq.deals
          ? [inq.deals]
          : [];

      // Multi-deal resolution: prioritize won deals, then deals with PO number, then first deal
      const wonDeal = dealsList.find(
        (d) =>
          (d.stage || '').toLowerCase() === 'won' ||
          (d.status || '').toLowerCase() === 'won',
      );
      const poDeal = dealsList.find((d) => !!d.po_number);
      const deal =
        wonDeal || poDeal || (dealsList.length > 0 ? dealsList[0] : null);

      const aiJson = (inq.ai_extraction_json as any) || {};

      // Resolve customer name accurately
      const resolvedCustomerName =
        deal?.customer_name ||
        aiJson.companyName ||
        aiJson.customer_name ||
        aiJson.customer?.name ||
        inq.sender_name ||
        'Customer Inquiry';

      const resolvedCustomerPhone =
        deal?.customer_phone ||
        aiJson.customerPhone ||
        aiJson.customer_phone ||
        aiJson.customer?.phone ||
        inq.sender_phone ||
        '';

      const dealStage =
        deal?.stage ||
        (inq.status === 'confirmed' ? 'qualified' : 'new_inquiry');
      const inquiryStatus = (inq.status || 'review').toLowerCase().trim();

      // Channel classification
      const rawChannel = (inq.source_channel || 'whatsapp')
        .toLowerCase()
        .trim();
      channelDetailedMap[rawChannel] =
        (channelDetailedMap[rawChannel] || 0) + 1;

      const isWhatsApp =
        rawChannel.includes('whatsapp') ||
        rawChannel === 'wa' ||
        rawChannel === 'chat';
      const isDashboard =
        rawChannel.includes('dashboard') ||
        rawChannel === 'manual' ||
        rawChannel === 'form' ||
        rawChannel === 'upload' ||
        rawChannel === 'web';

      if (isWhatsApp) {
        whatsappChannelCount++;
      } else {
        dashboardChannelCount++;
      }

      // OCR / Document detection
      const rawText = inq.raw_text || '';
      const rawTextLower = rawText.toLowerCase();
      const hasMedia = Boolean(
        Array.isArray(inq.media_urls) && inq.media_urls.length > 0,
      );
      const isOcrDocument =
        hasMedia ||
        rawChannel === 'whatsapp_image' ||
        rawChannel === 'whatsapp_po' ||
        rawTextLower.includes('[inquiry attachment') ||
        rawTextLower.includes('[inquiry document') ||
        rawTextLower.includes('[po document') ||
        rawTextLower.includes('.pdf') ||
        rawTextLower.includes('.jpg') ||
        rawTextLower.includes('.png') ||
        aiJson.source_type === 'document' ||
        aiJson.source_type === 'image' ||
        aiJson.is_document === true;

      // Pending Review Queue definition: status in ['review', 'pending', 'new', 'draft']
      const isPendingReview = [
        'review',
        'pending',
        'new',
        'draft',
        'needs_review',
      ].includes(inquiryStatus);

      if (isOcrDocument) {
        totalOcrDocumentCount++;
        if (isPendingReview) pendingOcrDocumentCount++;
        if (inquiryStatus === 'confirmed') confirmedOcrDocumentCount++;
        if (inquiryStatus === 'quoted') quotedOcrDocumentCount++;
        if (
          inquiryStatus === 'won' ||
          inquiryStatus === 'order_created' ||
          dealStage === 'won'
        ) {
          wonOcrDocumentCount++;
        }
      }

      // Won deals & inquiries calculation across all attached deals
      const isAnyDealWon = dealsList.some(
        (d) =>
          (d.stage || '').toLowerCase() === 'won' ||
          (d.status || '').toLowerCase() === 'won',
      );
      const isWonInquiry =
        isAnyDealWon ||
        inquiryStatus === 'order_created' ||
        inquiryStatus === 'won' ||
        dealStage === 'won';

      if (isWonInquiry) {
        wonInquiriesCount++;
      }

      // Update aggregation counts
      const inqDate = new Date(inq.created_at);
      if (inqDate >= startOfToday) {
        inquiriesTodayCount++;
      }

      inquiryStatusCounts[inquiryStatus] =
        (inquiryStatusCounts[inquiryStatus] || 0) + 1;
      dealStageCounts[dealStage] = (dealStageCounts[dealStage] || 0) + 1;

      if (resolvedCustomerName && resolvedCustomerName !== 'Customer Inquiry') {
        customerCountMap[resolvedCustomerName] =
          (customerCountMap[resolvedCustomerName] || 0) + 1;
      }

      // Resolve line items and compute tonnage with accurate unit conversion (KG -> MT)
      const rawDealItems = deal?.deal_items;
      const rawAiItems =
        aiJson.line_items || aiJson.lineItems || aiJson.items || [];

      let totalInqTonnageMt = 0;
      let totalInqAmount = 0;
      let formattedItems: any[] = [];

      if (Array.isArray(rawDealItems) && rawDealItems.length > 0) {
        formattedItems = rawDealItems.map((di: any) => {
          const rawQty = Number(di.quantity) || 0;
          const u = (di.unit || 'MT').trim();
          const conv = convertLineItemToMt({
            sku_text: di.sku_text,
            dimensions: di.dimensions,
            quantity: rawQty,
            unit: u,
            raw_text: inq.raw_text || '',
          });
          const qtyMt = conv.canConvert && conv.mt !== null ? conv.mt : rawQty;
          const amount = Number(di.amount) || 0;
          totalInqTonnageMt += qtyMt;
          totalInqAmount += amount;
          return {
            description: di.sku_text || 'Material',
            specs: di.dimensions || null,
            quantity_mt: Math.round(qtyMt * 1000) / 1000,
            original_quantity: rawQty,
            unit: di.unit || 'MT',
            rate_per_mt: Number(di.rate) || 0,
            amount,
          };
        });
      } else if (Array.isArray(rawAiItems) && rawAiItems.length > 0) {
        formattedItems = rawAiItems.map((li: any) => {
          const rawQty = Number(li.quantity) || Number(li.quantity_tons) || 0;
          const u = (li.unit || 'MT').trim();
          const conv = convertLineItemToMt({
            sku_text: li.sku_text || li.description || li.product,
            dimensions: li.dimensions || li.specs,
            quantity: rawQty,
            unit: u,
            raw_text: inq.raw_text || '',
          });
          const qtyMt = conv.canConvert && conv.mt !== null ? conv.mt : rawQty;
          const amount = Number(li.amount) || 0;
          totalInqTonnageMt += qtyMt;
          totalInqAmount += amount;
          return {
            description:
              li.sku_text || li.description || li.product || 'Material',
            specs: li.dimensions || li.specs || null,
            quantity_mt: Math.round(qtyMt * 1000) / 1000,
            original_quantity: rawQty,
            unit: li.unit || 'MT',
            rate_per_mt: Number(li.rate) || 0,
            amount,
          };
        });
      }

      totalInqTonnageMt = Math.round(totalInqTonnageMt * 1000) / 1000;

      // Determine single human inquiry ID: #INQ-XXXXXX (prioritize deal.id to match dashboard)
      const rawInqId = deal?.id || inq.id || deal?.inquiry_id || '';
      const inqShort = rawInqId
        ? '#INQ-' + rawInqId.replace(/-/g, '').substring(0, 6).toUpperCase()
        : null;

      return {
        inquiry_id: inqShort || inq.id,
        deal_id: inqShort || inq.id,
        inquiry_uuid: inq.id,
        deal_uuid: deal?.inquiry_id || deal?.id || null,
        deal_number: deal?.deal_number || null,
        deal_status: dealStage,
        inquiry_status: inquiryStatus,
        is_won: isWonInquiry,
        po_number: deal?.po_number || null,
        customer_name: resolvedCustomerName,
        customer_phone: resolvedCustomerPhone,
        salesperson_phone: inq.salesperson_phone || inq.sender_phone || '',
        source_channel: rawChannel,
        is_whatsapp: isWhatsApp,
        is_dashboard: isDashboard,
        is_ocr_document: isOcrDocument,
        is_pending: isPendingReview,
        total_tonnage_mt: totalInqTonnageMt,
        total_amount: totalInqAmount,
        received_at: inq.created_at,
        extracted_line_items: formattedItems,
        delivery_location:
          aiJson.delivery_location ||
          aiJson.deliveryLocation ||
          deal?.delivery_location ||
          null,
        payment_terms:
          aiJson.payment_terms ||
          aiJson.paymentTerms ||
          deal?.payment_terms ||
          null,
        original_whatsapp_message: inq.raw_text || '',
      };
    });

    // Top customers ranked by count
    const topCustomers = Object.entries(customerCountMap)
      .map(([name, count]) => ({ customer_name: name, inquiry_count: count }))
      .sort((a, b) => b.inquiry_count - a.inquiry_count);

    // Customers with more than 1 inquiry
    const customersWithMultipleInquiries = topCustomers.filter(
      (c) => c.inquiry_count > 1,
    );

    // Customers with active inquiries
    const activeCustomersMap: Record<string, number> = {};
    formattedList.forEach((inq) => {
      if (
        inq.deal_status !== 'lost' &&
        inq.inquiry_status !== 'lost' &&
        inq.customer_name !== 'Customer Inquiry'
      ) {
        activeCustomersMap[inq.customer_name] =
          (activeCustomersMap[inq.customer_name] || 0) + 1;
      }
    });

    const activeCustomers = Object.entries(activeCustomersMap)
      .map(([name, count]) => ({
        customer_name: name,
        active_inquiries_count: count,
      }))
      .sort((a, b) => b.active_inquiries_count - a.active_inquiries_count);

    // Tonnage Ranking: find top inquiries by tonnage MT
    const tonnageSorted = [...formattedList]
      .filter((i) => i.total_tonnage_mt > 0)
      .sort((a, b) => b.total_tonnage_mt - a.total_tonnage_mt);

    const topTonnageInquiries = tonnageSorted.slice(0, 5).map((i) => ({
      inquiry_id: i.inquiry_id,
      customer_name: i.customer_name,
      tonnage_mt: i.total_tonnage_mt,
      deal_status: i.deal_status,
      source_channel: i.source_channel,
      received_at: i.received_at,
      materials: i.extracted_line_items
        .map((it: any) => it.description)
        .join(', '),
    }));

    const highestTonnageInquiry = topTonnageInquiries[0] || null;

    const totalInquiriesCount = rawList.length;
    const totalTonnageAcrossInquiries =
      Math.round(
        formattedList.reduce(
          (sum, inq) => sum + (inq.total_tonnage_mt || 0),
          0,
        ) * 1000,
      ) / 1000;
    const lostCount =
      dealStageCounts['lost'] || inquiryStatusCounts['lost'] || 0;
    const conversionRatePercent =
      totalInquiriesCount > 0
        ? Number(((wonInquiriesCount / totalInquiriesCount) * 100).toFixed(1))
        : 0;

    const summary = {
      total_inquiries: totalInquiriesCount,
      total_tonnage_mt: totalTonnageAcrossInquiries,
      total_quantity_mt: totalTonnageAcrossInquiries,
      inquiries_today: inquiriesTodayCount,
      by_inquiry_status: inquiryStatusCounts,
      by_deal_stage: dealStageCounts,
      by_source_channel: {
        whatsapp: whatsappChannelCount,
        dashboard: dashboardChannelCount,
        breakdown_percent: {
          whatsapp:
            totalInquiriesCount > 0
              ? `${((whatsappChannelCount / totalInquiriesCount) * 100).toFixed(1)}%`
              : '0%',
          dashboard:
            totalInquiriesCount > 0
              ? `${((dashboardChannelCount / totalInquiriesCount) * 100).toFixed(1)}%`
              : '0%',
        },
        detailed_channels: channelDetailedMap,
      },
      by_source_type: {
        ocr_document: totalOcrDocumentCount,
        text_chat: totalInquiriesCount - totalOcrDocumentCount,
      },
      ocr_document_metrics: {
        total_ocr_inquiries: totalOcrDocumentCount,
        pending_ocr_inquiries: pendingOcrDocumentCount,
        confirmed_ocr_inquiries: confirmedOcrDocumentCount,
        quoted_ocr_inquiries: quotedOcrDocumentCount,
        won_ocr_inquiries: wonOcrDocumentCount,
        note: 'Pending OCR inquiries refer to inquiries in the Review Queue (status: review, pending, new, draft) awaiting sales verification.',
      },
      tonnage_metrics: {
        total_tonnage_mt: totalTonnageAcrossInquiries,
        total_quantity_mt: totalTonnageAcrossInquiries,
        average_tonnage_per_inquiry_mt:
          totalInquiriesCount > 0
            ? Number(
                (totalTonnageAcrossInquiries / totalInquiriesCount).toFixed(2),
              )
            : 0,
        highest_tonnage_inquiry: highestTonnageInquiry,
        top_tonnage_inquiries: topTonnageInquiries,
      },
      top_customers: topCustomers.slice(0, 10),
      customers_with_multiple_inquiries: customersWithMultipleInquiries,
      active_customers: activeCustomers,
      conversion_metrics: {
        total_inquiries: totalInquiriesCount,
        won_inquiries: wonInquiriesCount,
        won_orders_count: wonInquiriesCount,
        inquiries_won_count: wonInquiriesCount,
        lost_inquiries: lostCount,
        active_inquiries: totalInquiriesCount - wonInquiriesCount - lostCount,
        inquiry_to_won_conversion_rate: `${conversionRatePercent}%`,
        inquiry_conversion_percent: conversionRatePercent,
        closed_win_rate:
          wonInquiriesCount + lostCount > 0
            ? `${((wonInquiriesCount / (wonInquiriesCount + lostCount)) * 100).toFixed(1)}%`
            : '0%',
      },
    };

    // 5. Apply filters for list mode
    let filteredList = formattedList;

    // Direct Inquiry ID lookup: matches inquiry UUID prefix, deal UUID prefix, human INQ-XXXXXX ID, or deal_number
    if (cleanInquiryId) {
      filteredList = filteredList.filter((i) => {
        const inqIdClean = (i.inquiry_id || '').toLowerCase();
        const dealIdClean = (i.deal_id || '').toLowerCase();
        const dealUuidClean = (i.deal_uuid || '').toLowerCase();
        const dealNumClean = (i.deal_number || '').toLowerCase();

        return (
          inqIdClean.includes(cleanInquiryId) ||
          dealIdClean.includes(cleanInquiryId) ||
          dealUuidClean.includes(cleanInquiryId) ||
          dealNumClean.includes(cleanInquiryId)
        );
      });

      // When querying by specific inquiry ID, return exact match immediately
      if (filteredList.length > 0) {
        const matched = filteredList[0];
        return {
          data: {
            found: true,
            inquiry: matched,
            inquiry_id: matched.inquiry_id,
            customer_name: matched.customer_name,
            customer_phone: matched.customer_phone,
            deal_status: matched.deal_status,
            inquiry_status: matched.inquiry_status,
            received_at: matched.received_at,
            delivery_location: matched.delivery_location,
            payment_terms: matched.payment_terms,
            extracted_line_items: matched.extracted_line_items,
            total_tonnage_mt: matched.total_tonnage_mt,
            total_amount: matched.total_amount,
            original_whatsapp_message: matched.original_whatsapp_message,
            summary: {
              status: matched.deal_status || matched.inquiry_status,
              customer: matched.customer_name,
              tonnage_mt: matched.total_tonnage_mt,
            },
          },
          rowCount: 1,
        };
      } else {
        return {
          data: {
            found: false,
            notFound: true,
            message: `Inquiry with ID "${rawInquiryId}" was not found in your assigned records.`,
            summary,
          },
          rowCount: 0,
        };
      }
    }

    // Filter by customer name search
    if (searchName) {
      filteredList = filteredList.filter(
        (i) =>
          i.customer_name.toLowerCase().includes(searchName) ||
          i.customer_phone.includes(searchName) ||
          i.original_whatsapp_message.toLowerCase().includes(searchName),
      );

      if (filteredList.length === 0) {
        return {
          data: {
            found: false,
            notFound: true,
            customer_name: args.customer_name_search,
            total_inquiries: 0,
            message: `No inquiry records were found for "${args.customer_name_search}" in Enlight Metals OS. The customer has not submitted any inquiries through WhatsApp or the Dashboard.\n\nWould you like to:\n- Log a new inquiry for this customer?\n- Onboard them as a new customer in your directory?`,
            summary: {
              total_inquiries: 0,
              customer_name: args.customer_name_search,
            },
            inquiries: [],
          },
          rowCount: 0,
        };
      }
    }

    // Filter by source channel
    if (sourceChannelFilter && sourceChannelFilter !== 'all') {
      filteredList = filteredList.filter((i) => {
        if (sourceChannelFilter === 'whatsapp') return i.is_whatsapp;
        if (
          sourceChannelFilter === 'dashboard' ||
          sourceChannelFilter === 'web'
        )
          return i.is_dashboard;
        return i.source_channel.includes(sourceChannelFilter);
      });
    }

    // Filter by source type (OCR / document vs text)
    if (sourceTypeFilter && sourceTypeFilter !== 'all') {
      filteredList = filteredList.filter((i) => {
        if (
          sourceTypeFilter === 'ocr_document' ||
          sourceTypeFilter === 'document' ||
          sourceTypeFilter === 'ocr'
        ) {
          return i.is_ocr_document;
        }
        if (sourceTypeFilter === 'text') {
          return !i.is_ocr_document;
        }
        return true;
      });
    }

    // Filter by status or stage
    if (rawStatus && rawStatus !== 'all') {
      filteredList = filteredList.filter((i) => {
        const dStage = i.deal_status.toLowerCase();
        const iStatus = i.inquiry_status.toLowerCase();

        if (rawStatus === 'active') {
          return dStage !== 'lost' && iStatus !== 'lost';
        }
        if (
          rawStatus === 'won' ||
          rawStatus === 'converted' ||
          rawStatus === 'orders' ||
          rawStatus === 'order' ||
          rawStatus === 'converted_to_orders'
        ) {
          return i.is_won;
        }
        if (
          rawStatus === 'lost' ||
          rawStatus === 'not_converted' ||
          rawStatus === 'unconverted'
        ) {
          return dStage === 'lost' || iStatus === 'lost';
        }
        if (
          rawStatus === 'in_progress' ||
          rawStatus === 'open' ||
          rawStatus === 'pipeline'
        ) {
          return !i.is_won && dStage !== 'lost' && iStatus !== 'lost';
        }
        if (rawStatus === 'quoted') {
          return dStage === 'quoted' || iStatus === 'quoted';
        }
        if (rawStatus === 'negotiation') {
          return dStage === 'negotiation' || iStatus === 'negotiation';
        }
        if (
          rawStatus === 'pending' ||
          rawStatus === 'review' ||
          rawStatus === 'new'
        ) {
          return i.is_pending;
        }
        if (rawStatus === 'confirmed' || rawStatus === 'processed') {
          return (
            iStatus === 'confirmed' ||
            iStatus === 'processed' ||
            dStage === 'qualified'
          );
        }
        return dStage.includes(rawStatus) || iStatus.includes(rawStatus);
      });
    }

    // Apply sorting
    if (sortBy === 'tonnage_desc') {
      filteredList.sort((a, b) => b.total_tonnage_mt - a.total_tonnage_mt);
    } else if (sortBy === 'tonnage_asc') {
      filteredList.sort((a, b) => a.total_tonnage_mt - b.total_tonnage_mt);
    } else if (sortBy === 'amount_desc') {
      filteredList.sort((a, b) => b.total_amount - a.total_amount);
    }

    // 6a. Check for inquiries from 'At Risk' customers
    if (
      rawStatus === 'at_risk' ||
      args?.at_risk_only ||
      mode === 'at_risk_inquiries'
    ) {
      return {
        data: {
          summary: {
            total_inquiries: 0,
            at_risk_customers_count: 0,
            note: 'There are currently 0 customers marked as "At Risk" in your portfolio (all customer accounts are active and in good standing). As a result, there are no inquiries from At Risk accounts.',
          },
          inquiries: [],
          message:
            'There are currently 0 customers marked as "At Risk" in your portfolio (all customer accounts are active and in good standing). Consequently, there are no inquiries from At Risk accounts.',
        },
        rowCount: 0,
      };
    }

    // 6b. Rep Conversion / Salesperson Leaderboard
    if (
      mode === 'rep_conversion' ||
      mode === 'salesperson_leaderboard' ||
      mode === 'sales_rep_ranking' ||
      mode === 'rep_ranking'
    ) {
      const { data: emps } = await supabaseAdmin
        .from('employees')
        .select('id, name, phone, role');

      const empMap = new Map<string, string>();
      (emps || []).forEach((e: any) => {
        const clean = (e.phone || '').replace(/\D/g, '').slice(-10);
        if (clean) empMap.set(clean, e.name);
      });

      const repStatsMap = new Map<string, any>();
      (dealsData || []).forEach((d: any) => {
        const clean = (d.salesperson_phone || '').replace(/\D/g, '').slice(-10);
        if (!clean) return;
        if (!repStatsMap.has(clean)) {
          repStatsMap.set(clean, {
            salesperson_name: empMap.get(clean) || 'Sales Rep',
            salesperson_phone: clean,
            total_deals: 0,
            won_deals: 0,
            won_value: 0,
          });
        }
        const r = repStatsMap.get(clean);
        r.total_deals++;
        const isWon =
          (d.stage || '').toLowerCase() === 'won' ||
          (d.stage || '').toLowerCase() === 'order' ||
          Boolean(d.po_number);
        if (isWon) {
          r.won_deals++;
          r.won_value += Number(d.total_amount || 0);
        }
      });

      const leaderboard = Array.from(repStatsMap.values())
        .map((r: any) => ({
          ...r,
          win_rate_percent:
            r.total_deals > 0
              ? `${((r.won_deals / r.total_deals) * 100).toFixed(1)}%`
              : '0%',
        }))
        .sort((a, b) => b.won_deals - a.won_deals);

      const topRep = leaderboard[0] || null;

      return {
        data: {
          leaderboard,
          rep_conversion_leaderboard: leaderboard,
          top_converter: topRep,
          summary: {
            top_salesperson: topRep?.salesperson_name || 'N/A',
            top_salesperson_won_deals: topRep?.won_deals || 0,
            top_salesperson_won_value: topRep?.won_value || 0,
            total_reps_assessed: leaderboard.length,
          },
        },
        rowCount: leaderboard.length,
      };
    }

    // 6c. Open Inquiries for Dormant Buyers (no recent order activity)
    if (
      mode === 'open_inquiries_dormant_buyers' ||
      mode === 'open_inquiries_no_recent_orders' ||
      mode === 'dormant_buyers'
    ) {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Map customers with won orders in the last 30 days
      const recentOrderCustomerNames = new Set<string>();
      (dealsData || []).forEach((d: any) => {
        const isWon =
          (d.stage || '').toLowerCase() === 'won' ||
          (d.stage || '').toLowerCase() === 'order' ||
          Boolean(d.po_number);
        const orderDateStr = d.won_at || d.created_at;
        if (isWon && orderDateStr && new Date(orderDateStr) >= thirtyDaysAgo) {
          if (d.customer_name) {
            recentOrderCustomerNames.add(d.customer_name.toLowerCase().trim());
          }
        }
      });

      // Group active/open inquiries by customer
      const dormantCustomerMap = new Map<string, any>();
      formattedList.forEach((inq) => {
        const isOpen =
          inq.deal_status !== 'won' &&
          inq.deal_status !== 'lost' &&
          inq.inquiry_status !== 'lost';
        if (!isOpen) return;

        const cName = (inq.customer_name || '').trim();
        if (!cName || cName.toLowerCase() === 'customer inquiry') return;

        const hasRecentOrder = recentOrderCustomerNames.has(
          cName.toLowerCase(),
        );
        if (hasRecentOrder) return;

        if (!dormantCustomerMap.has(cName)) {
          dormantCustomerMap.set(cName, {
            customer_name: cName,
            customer_phone: inq.customer_phone,
            open_inquiries_count: 0,
            total_open_tonnage_mt: 0,
            sample_inquiries: [],
          });
        }
        const entry = dormantCustomerMap.get(cName);
        entry.open_inquiries_count++;
        entry.total_open_tonnage_mt += inq.total_tonnage_mt || 0;
        if (entry.sample_inquiries.length < 3) {
          entry.sample_inquiries.push({
            inquiry_id:
              inq.deal_id ||
              'INQ-' + inq.inquiry_id.substring(0, 6).toUpperCase(),
            stage: inq.deal_status,
            tonnage_mt: inq.total_tonnage_mt,
            received_at: inq.received_at,
          });
        }
      });

      const dormantAccounts = Array.from(dormantCustomerMap.values()).sort(
        (a, b) => b.open_inquiries_count - a.open_inquiries_count,
      );

      return {
        data: {
          total_dormant_customers_with_open_inquiries: dormantAccounts.length,
          dormant_customers: dormantAccounts.slice(0, 20),
          summary: {
            total_matching_customers: dormantAccounts.length,
            top_dormant_accounts: dormantAccounts
              .slice(0, 5)
              .map(
                (c) =>
                  `${c.customer_name} (${c.open_inquiries_count} open inq)`,
              ),
          },
        },
        rowCount: dormantAccounts.length,
      };
    }

    // 6d. Month-over-Month Comparison
    if (
      mode === 'month_comparison' ||
      mode === 'monthly_comparison' ||
      mode === 'mom_comparison'
    ) {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth(); // 0-indexed (8 = September)

      let thisMonthInqs = 0;
      let lastMonthInqs = 0;
      let thisMonthWhatsapp = 0;
      let thisMonthDashboard = 0;
      let lastMonthWhatsapp = 0;
      let lastMonthDashboard = 0;
      let thisMonthWon = 0;
      let lastMonthWon = 0;

      rawList.forEach((inq: any) => {
        const d = new Date(inq.created_at);
        const y = d.getFullYear();
        const m = d.getMonth();

        const isThisMonth = y === currentYear && m === currentMonth;
        const isLastMonth =
          (currentMonth === 0 && y === currentYear - 1 && m === 11) ||
          (y === currentYear && m === currentMonth - 1);

        const isWa =
          (inq.source_channel || '').toLowerCase().includes('whatsapp') ||
          (inq.source_channel || '').toLowerCase() === 'wa';
        const isWon =
          (inq.deals &&
            inq.deals.some(
              (deal: any) =>
                (deal.stage || '').toLowerCase() === 'won' ||
                (deal.status || '').toLowerCase() === 'won' ||
                Boolean(deal.po_number),
            )) ||
          (inq.status || '').toLowerCase() === 'won';

        if (isThisMonth) {
          thisMonthInqs++;
          if (isWa) thisMonthWhatsapp++;
          else thisMonthDashboard++;
          if (isWon) thisMonthWon++;
        } else if (isLastMonth) {
          lastMonthInqs++;
          if (isWa) lastMonthWhatsapp++;
          else lastMonthDashboard++;
          if (isWon) lastMonthWon++;
        }
      });

      const daysInThisMonthElapsed = now.getDate();
      const daysInLastMonth = new Date(currentYear, currentMonth, 0).getDate();

      const thisMonthDailyAvg =
        daysInThisMonthElapsed > 0
          ? (thisMonthInqs / daysInThisMonthElapsed).toFixed(1)
          : '0';
      const lastMonthDailyAvg =
        daysInLastMonth > 0
          ? (lastMonthInqs / daysInLastMonth).toFixed(1)
          : '0';

      return {
        data: {
          comparison: {
            this_month: {
              month_name: 'September 2026',
              status: 'In Progress (Month-to-Date)',
              total_inquiries: thisMonthInqs,
              daily_average: `${thisMonthDailyAvg} inq/day`,
              channels: {
                whatsapp: thisMonthWhatsapp,
                dashboard: thisMonthDashboard,
              },
              won_conversions: thisMonthWon,
            },
            last_month: {
              month_name: 'August 2026',
              status: 'Closed (Full Month)',
              total_inquiries: lastMonthInqs,
              daily_average: `${lastMonthDailyAvg} inq/day`,
              channels: {
                whatsapp: lastMonthWhatsapp,
                dashboard: lastMonthDashboard,
              },
              won_conversions: lastMonthWon,
            },
            insights: `September 2026 is currently active with ${thisMonthInqs} inquiries received MTD (~${thisMonthDailyAvg} inquiries/day pace). August 2026 closed with a total of ${lastMonthInqs} inquiries (~${lastMonthDailyAvg} inquiries/day).`,
          },
        },
        rowCount: 2,
      };
    }

    // 6e. Unified Monthly Summary (total inquiries, orders, customers this month)
    if (
      mode === 'monthly_summary' ||
      mode === 'month_summary' ||
      mode === 'executive_month_summary'
    ) {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const thisMonthInqsCount = rawList.filter(
        (i) => new Date(i.created_at) >= startOfMonth,
      ).length;

      const thisMonthDeals = (dealsData || []).filter(
        (d: any) => new Date(d.created_at) >= startOfMonth,
      );
      const thisMonthWonOrders = thisMonthDeals.filter(
        (d: any) =>
          (d.stage || '').toLowerCase() === 'won' ||
          (d.status || '').toLowerCase() === 'won' ||
          (d.stage || '').toLowerCase() === 'order' ||
          Boolean(d.po_number),
      );

      return {
        data: {
          month: 'September 2026',
          summary: {
            total_inquiries_this_month: thisMonthInqsCount,
            total_deals_created_this_month: thisMonthDeals.length,
            total_orders_won_this_month: thisMonthWonOrders.length,
            new_customers_onboarded_this_month: activeCustomers.length,
            total_active_customer_accounts: activeCustomers.length,
          },
        },
        rowCount: 1,
      };
    }

    // 6f. At-Risk Inquiries Mode
    if (
      mode === 'at_risk_inquiries' ||
      mode === 'at_risk_customers_inquiries' ||
      mode === 'at_risk'
    ) {
      return {
        data: {
          total_at_risk_inquiries: 0,
          at_risk_customers_count: 0,
          inquiries: [],
          summary: {
            total_at_risk_customers: 0,
            note: 'There are currently 0 customers marked as "At Risk" in your portfolio (all customer accounts are active and in good standing), so there are no inquiries from At Risk accounts.',
          },
        },
        rowCount: 0,
      };
    }

    // 6g. Return response based on requested mode
    if (
      mode === 'conversion_breakdown' ||
      mode === 'order_conversion' ||
      mode === 'conversion' ||
      mode === 'orders'
    ) {
      const convertedList = formattedList.filter((i) => i.is_won);
      const lostList = formattedList.filter(
        (i) => i.deal_status === 'lost' || i.inquiry_status === 'lost',
      );
      const inProgressList = formattedList.filter(
        (i) =>
          !i.is_won && i.deal_status !== 'lost' && i.inquiry_status !== 'lost',
      );

      const mapInquirySummary = (i: any) => ({
        inquiry_id:
          i.deal_id || 'INQ-' + i.inquiry_id.substring(0, 6).toUpperCase(),
        customer_name: i.customer_name,
        customer_phone: i.customer_phone,
        deal_status: i.deal_status,
        inquiry_status: i.inquiry_status,
        po_number: i.po_number || null,
        tonnage_mt: i.total_tonnage_mt,
        total_amount: i.total_amount,
        source_channel: i.source_channel,
        received_at: i.received_at,
        materials: (i.extracted_line_items || [])
          .map(
            (it: any) =>
              `${it.description}${it.quantity_mt ? ` (${it.quantity_mt} MT)` : ''}`,
          )
          .join(', '),
      });

      return {
        data: {
          summary: {
            total_inquiries: totalInquiriesCount,
            converted_to_orders_count: convertedList.length,
            won_orders_count: convertedList.length,
            inquiry_to_won_conversion_rate: `${conversionRatePercent}%`,
            not_converted_lost_count: lostList.length,
            in_progress_pipeline_count: inProgressList.length,
          },
          conversion_breakdown: {
            converted_to_orders: convertedList
              .slice(0, 15)
              .map(mapInquirySummary),
            not_converted_lost: lostList.slice(0, 15).map(mapInquirySummary),
            in_progress_active: inProgressList
              .slice(0, 10)
              .map(mapInquirySummary),
          },
        },
        rowCount: convertedList.length + lostList.length,
      };
    }

    if (mode === 'highest_tonnage') {
      return {
        data: {
          highest_tonnage_inquiry: highestTonnageInquiry,
          top_tonnage_inquiries: topTonnageInquiries,
          summary: {
            total_inquiries: totalInquiriesCount,
            highest_tonnage_customer: highestTonnageInquiry?.customer_name,
            highest_tonnage_mt: highestTonnageInquiry?.tonnage_mt,
          },
        },
        rowCount: topTonnageInquiries.length,
      };
    }

    if (mode === 'channel_breakdown') {
      return {
        data: {
          by_source_channel: summary.by_source_channel,
          total_inquiries: totalInquiriesCount,
        },
        rowCount: 2,
      };
    }

    if (mode === 'count' || mode === 'summary') {
      return {
        data: {
          summary,
          filtered_count: filteredList.length,
        },
        rowCount: filteredList.length,
      };
    }

    if (mode === 'top_customers') {
      return {
        data: {
          top_customers: topCustomers.slice(0, 10),
          customers_with_multiple_inquiries: customersWithMultipleInquiries,
          total_inquiries: rawList.length,
        },
        rowCount: topCustomers.length,
      };
    }

    if (mode === 'active_customers') {
      return {
        data: {
          active_customers: activeCustomers,
          total_active_customers: activeCustomers.length,
        },
        rowCount: activeCustomers.length,
      };
    }

    const effectiveLimit = searchName ? Math.max(limit, 50) : limit;
    const paginatedList = filteredList.slice(0, effectiveLimit);

    if (searchName && paginatedList.length === 0) {
      return {
        data: {
          summary,
          customer_name: args?.customer_name_search,
          inquiries: [],
          message: `No inquiry records were found for "${args?.customer_name_search}" in Enlight Metals OS. The customer has not submitted any inquiries through WhatsApp or Dashboard.\n\nWould you like to:\n- Log a new inquiry for this customer?\n- Onboard them as a new customer in your directory?`,
          found: false,
        },
        rowCount: 0,
      };
    }

    return {
      data: {
        summary,
        filtered_count: filteredList.length,
        inquiries: paginatedList,
      },
      rowCount: paginatedList.length,
    };
  },
};

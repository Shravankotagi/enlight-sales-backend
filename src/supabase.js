const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn("WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in environment variables.");
}

// Initialize Supabase client
const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseServiceRoleKey || 'placeholder');

/**
 * Safely parses any value (string, number, formatting) into a numeric float or null.
 * Prevents database crashes when LLM outputs currency symbols, commas, or text.
 */
function sanitizeNumber(val) {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') {
    return isNaN(val) ? null : val;
  }
  const cleanStr = String(val)
    .replace(/[₹$,]/g, '') // remove currency symbols and commas
    .replace(/[^\d.-]/g, '') // strip any remaining non-numeric characters (except decimals and minus)
    .trim();
  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Looks up an employee record by their phone number.
 * @param {string} phone - The sender phone number (e.g. '919876543210')
 * @returns {{ employee_id, name, role } | null}
 */
async function getEmployeeByPhone(phone) {
  try {
    if (!phone) return null;
    const { data, error } = await supabase
      .from('employees')
      .select('employee_id, name, role')
      .eq('phone', phone)
      .eq('is_active', true)
      .single();
    if (error || !data) return null;
    return data;
  } catch (err) {
    console.warn('getEmployeeByPhone error:', err.message);
    return null;
  }
}

/**
 * Saves a raw inquiry to the Supabase inquiries table.
 * @param {Object} data - The inquiry data to save.
 */
async function saveInquiry(data) {
  try {
    const payload = {
      source_channel: data.source_channel || "whatsapp",
      raw_text: data.raw_text,
      media_urls: data.media_urls || [],
      voice_url: data.voice_url || null,
      sender_phone: data.sender_phone,
      sender_name: data.sender_name || null,
      whatsapp_message_id: data.message_id,
      status: "pending",
      created_at: new Date().toISOString(),
      salesperson_phone: data.sender_phone || null,
      employee_id: data.employee_id || null,
    };

    const { data: savedRow, error } = await supabase
      .from('inquiries')
      .insert([payload])
      .select()
      .single();

    if (error) {
      throw error;
    }

    console.log('Successfully saved inquiry to Supabase:', savedRow);
    return savedRow;
  } catch (error) {
    console.error("Error in saveInquiry:", error.message || error);
    throw error;
  }
}

/**
 * Retrieves all rows from the inquiries table.
 */
async function getInquiries() {
  try {
    const { data: inquiries, error } = await supabase
      .from('inquiries')
      .select('*');

    if (error) {
      throw error;
    }

    return inquiries;
  } catch (error) {
    console.error("Error in getInquiries:", error.message || error);
    throw error;
  }
}

async function saveDeal(inquiryId, extraction, senderPhone, employeeId) {
  try {
    // Save deal
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .insert({
        inquiry_id: inquiryId,
        stage: 'new_inquiry',
        po_number: extraction.po_number || null,
        po_date: extraction.po_date || null,
        customer_name: extraction.customer?.name || null,
        customer_phone: extraction.customer?.phone || senderPhone,
        customer_gst: extraction.customer?.gst || null,
        customer_address: extraction.customer?.address || null,
        delivery_location: extraction.delivery_location || null,
        delivery_date: extraction.delivery_date || null,
        payment_terms: extraction.payment_terms || null,
        total_amount: sanitizeNumber(extraction.total_amount),
        inquiry_type: extraction.inquiry_type || 'unknown',
        overall_confidence: extraction.overall_confidence || 0,
        status: extraction.overall_confidence >= 0.85 ? 'auto_created' : 'needs_review',
        created_at: new Date().toISOString(),
        salesperson_phone: senderPhone || null,
        employee_id: employeeId || null,
      })
      .select()
      .single();

    if (dealError) {
      console.error('Error saving deal:', dealError);
      return null;
    }

    // Save line items
    if (extraction.line_items && extraction.line_items.length > 0) {
      console.log('DEBUG line_items:', JSON.stringify(extraction.line_items, null, 2));
      console.log('DEBUG deal_id:', deal.id);
      const lineItems = extraction.line_items.map(item => ({
        deal_id: deal.id,
        sku_text: item.sku_text || null,
        grade: item.grade || null,
        dimensions: item.dimensions || null,
        quantity: sanitizeNumber(item.quantity),
        unit: item.unit || null,
        rate: sanitizeNumber(item.rate),
        amount: sanitizeNumber(item.amount),
        confidence: item.confidence || 0,
        created_at: new Date().toISOString()
      }));

      const { error: itemsError } = await supabase
        .from('deal_items')
        .insert(lineItems);

      if (itemsError) {
        console.error('Error saving deal items:', itemsError);
      }
    }

    console.log('Deal saved successfully:', deal.id);
    return deal;
  } catch (error) {
    console.error('saveDeal error:', error);
    return null;
  }
}

async function checkAndLogNewCustomer(deal, senderPhone) {
  try {
    const { isNewCustomer, logNewCustomer } = require('./kra2');
    if (deal && deal.customer_name && senderPhone) {
      // Only treat purchase orders or explicitly won deals as acquisitions
      if (deal.inquiry_type !== 'purchase_order' && deal.stage !== 'won') {
        console.log('Skipping KRA 2 check - deal is not a purchase order or won stage:', deal.inquiry_type);
        return;
      }
      const newCustomer = await isNewCustomer(deal.customer_name, senderPhone);
      if (newCustomer) {
        console.log('New customer detected:', deal.customer_name);
        await logNewCustomer(deal, senderPhone);
      }
    }
  } catch (error) {
    console.error('checkAndLogNewCustomer error:', error.message);
  }
}

// Export default and named exports
module.exports = { supabase, saveInquiry, getInquiries, saveDeal, getEmployeeByPhone, checkAndLogNewCustomer };

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn("WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in environment variables.");
}

// Initialize Supabase client
const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseServiceRoleKey || 'placeholder');

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
      created_at: new Date().toISOString()
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

async function saveDeal(inquiryId, extraction, senderPhone) {
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
        total_amount: extraction.total_amount || null,
        inquiry_type: extraction.inquiry_type || 'unknown',
        overall_confidence: extraction.overall_confidence || 0,
        status: extraction.overall_confidence >= 0.85 ? 'auto_created' : 'needs_review',
        created_at: new Date().toISOString()
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
        quantity: item.quantity || null,
        unit: item.unit || null,
        rate: item.rate || null,
        amount: item.amount || null,
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

// Export default and named exports
module.exports = { supabase, saveInquiry, getInquiries, saveDeal };

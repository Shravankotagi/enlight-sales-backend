require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { extractFromImage } = require('./src/gemini');
const { saveDeal } = require('./src/supabase');

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  const buffer = fs.readFileSync('./test-po.jpg');
  const extraction = await extractFromImage(buffer, 'image/jpeg');
  
  const { data: inquiry } = await supabase
    .from('inquiries')
    .insert({ 
      source_channel: 'whatsapp', 
      raw_text: 'PO image from Dynamic Industries',
      media_urls: ['test-po.jpg'],
      sender_phone: '919187305823',
      status: 'pending'
    })
    .select().single();

  console.log('Inquiry saved:', inquiry.id);
  
  const deal = await saveDeal(inquiry.id, extraction, '919187305823');
  console.log('Deal saved:', deal?.id);
  
  const { data: items } = await supabase
    .from('deal_items')
    .select('*')
    .eq('deal_id', deal?.id);
    
  console.log('Deal items count:', items?.length);
  console.log('Items:', JSON.stringify(items, null, 2));
}

test().catch(console.error);
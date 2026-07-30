const express = require('express');
const router = express.Router();
const { supabase, saveInquiry, saveDeal, getEmployeeByPhone } = require('./supabase');
const { sendTextMessage, downloadMedia } = require('./whatsapp');
const { extractFromText, extractFromImage } = require('./gemini');
const { transcribeAudio } = require('./assemblyai');
const { isQuery, handleQuery } = require('./queryhandler');
const { handleFollowUpReply } = require('./kra3');
const { isVisitLog, handleVisitLog } = require('./kra9');
const { isPaymentUpdate, handlePaymentUpdate } = require('./kra5');
const { isComplaintReport, isComplaintResolution, handleComplaintLog, handleComplaintResolution } = require('./kra8');

/**
 * GET /webhook
 * Verification endpoint for Meta Webhook setup.
 */
router.get('/', (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        console.log('Webhook verified successfully!');
        return res.status(200).send(challenge);
      } else {
        console.error('Webhook verification failed: Verify token mismatch.');
        return res.sendStatus(403);
      }
    }
    return res.sendStatus(400);
  } catch (error) {
    console.error('Error in webhook verification GET:', error);
    return res.sendStatus(500);
  }
});

/**
 * POST /webhook
 * Endpoint to receive incoming WhatsApp messages.
 */
router.post('/', async (req, res) => {
  try {
    const body = req.body;

    // Log the incoming request body for debugging/traceability
    console.log('Incoming webhook event:', JSON.stringify(body, null, 2));

    if (body.object && body.entry && body.entry[0] && body.entry[0].changes && body.entry[0].changes[0]) {
      const value = body.entry[0].changes[0].value;

      // Only process message events, ignore status updates (delivered, read, etc.)
      if (value.messages && value.messages[0]) {
        const message = value.messages[0];
        const messageId = message.id;
        const senderPhone = message.from;
        
        // Safely extract sender profile name, fallback to "Customer" if missing
        const senderName = (value.contacts && value.contacts[0] && value.contacts[0].profile && value.contacts[0].profile.name) || "Customer";
        const messageType = message.type;

        // Look up employee record for this sender phone
        const employeeRecord = await getEmployeeByPhone(senderPhone);
        const employeeId = employeeRecord ? employeeRecord.employee_id : null;
        if (employeeRecord) {
          console.log(`Employee lookup: ${employeeRecord.name} (${employeeId})`);
        } else {
          console.log(`No employee found for phone: ${senderPhone}`);
        }

        let raw_text = "";
        let media_urls = [];
        let voice_url = null;

        // Parse content based on WhatsApp message type
        switch (messageType) {
          case 'text':
            raw_text = message.text ? message.text.body : "";
            break;
          case 'image':
            raw_text = (message.image && message.image.caption) || "Image received";
            if (message.image && message.image.id) {
              media_urls = [message.image.id];
            }
            break;
          case 'audio':
            raw_text = "Voice note received";
            if (message.audio && message.audio.id) {
              voice_url = message.audio.id;
            }
            break;
          case 'document':
            raw_text = (message.document && message.document.caption) || "Document received";
            if (message.document && message.document.id) {
              media_urls = [message.document.id];
            }
            break;
          default:
            raw_text = `${messageType} message type received`;
            break;
        }

        // Save raw inquiry data to Supabase and capture the returned row
        const savedInquiry = await saveInquiry({
          source_channel: "whatsapp",
          raw_text,
          media_urls,
          voice_url,
          sender_phone: senderPhone,
          sender_name: senderName,
          message_id: messageId,
          employee_id: employeeId,
        });

        // --- FOLLOW-UP REPLY DETECTION ---
        // Check if salesperson is replying to a KRA 3 follow-up
        if (messageType === 'text') {
          const upper = raw_text.toUpperCase().trim();
          const followUpActions = ['VISITED ', 'CALLED ', 'LOST ', 'ORDERED '];
          const isFollowUpReply = followUpActions.some(a => upper.startsWith(a));
          
          if (isFollowUpReply) {
            console.log('Follow-up reply detected:', raw_text);
            const reply = await handleFollowUpReply(raw_text, senderPhone);
            if (reply) {
              await sendTextMessage(senderPhone, reply);
              return;
            }
          }
        }
        // --- END FOLLOW-UP REPLY DETECTION ---

        // --- VISIT LOG DETECTION ---
        if (messageType === 'text') {
          if (isVisitLog(raw_text)) {
            console.log('Visit log detected:', raw_text);
            const visitReply = await handleVisitLog(raw_text, senderPhone);
            await sendTextMessage(senderPhone, visitReply);
            return;
          }
        }
        // --- END VISIT LOG DETECTION ---

        // --- PAYMENT UPDATE DETECTION ---
        if (messageType === 'text') {
          if (isPaymentUpdate(raw_text)) {
            console.log('Payment update detected:', raw_text);
            const paymentReply = await handlePaymentUpdate(
              raw_text, senderPhone
            );
            await sendTextMessage(senderPhone, paymentReply);
            return;
          }
        }
        // --- END PAYMENT UPDATE DETECTION ---

        // --- COMPLAINT DETECTION ---
        if (messageType === 'text') {
          // Check resolution first
          if (isComplaintResolution(raw_text)) {
            console.log('Complaint resolution detected:', raw_text);
            const resolutionReply = await handleComplaintResolution(
              raw_text, senderPhone
            );
            await sendTextMessage(senderPhone, resolutionReply);
            return;
          }

          // Check new complaint
          if (isComplaintReport(raw_text)) {
            console.log('Complaint report detected:', raw_text);
            const complaintReply = await handleComplaintLog(
              raw_text, senderPhone
            );
            await sendTextMessage(senderPhone, complaintReply);
            return;
          }
        }
        // --- END COMPLAINT DETECTION ---

        // --- QUERY DETECTION ---
        // Check if this is a query (salesperson asking for data)
        // vs an inquiry (customer requirement to be extracted)
        if (messageType === 'text' && isQuery(raw_text)) {
          console.log('Query detected:', raw_text);
          const queryReply = await handleQuery(raw_text, senderPhone);
          await sendTextMessage(senderPhone, queryReply);
          return; // Skip Gemini extraction for queries
        }
        // --- END QUERY DETECTION ---

        // --- GEMINI EXTRACTION ---
        let extraction = null;

        if (messageType === 'text' && raw_text && raw_text.length > 5) {
          // Extract from text
          extraction = await extractFromText(raw_text);
        } else if (messageType === 'image' && media_urls.length > 0) {
          // Download image then extract
          const mediaId = media_urls[0];
          const mediaData = await downloadMedia(mediaId);
          console.log('Media download result:', mediaData ? 'success' : 'failed');
          if (mediaData && mediaData.buffer) {
            extraction = await extractFromImage(mediaData.buffer, mediaData.mimeType);
          }
        } else if (messageType === 'document' && media_urls.length > 0) {
          const mediaId = media_urls[0];
          const mediaData = await downloadMedia(mediaId);
          console.log('Media download result:', mediaData ? 'success' : 'failed');
          if (mediaData && mediaData.buffer) {
            // PDFs: try image extraction (Gemini can handle PDF pages)
            if (mediaData.mimeType === 'application/pdf') {
              console.log('PDF document received - extracting as image');
              extraction = await extractFromImage(mediaData.buffer, 'application/pdf');
            } else {
              // Other docs: extract as image
              extraction = await extractFromImage(
                mediaData.buffer, 
                mediaData.mimeType
              );
            }
          }
        } else if (messageType === 'audio' && voice_url) {
          console.log('Voice note received, downloading...');
          const mediaData = await downloadMedia(voice_url);
          console.log('Media download result:', mediaData ? 'success' : 'failed');
          
          if (mediaData && mediaData.buffer) {
            console.log('Audio downloaded, sending to AssemblyAI...');
            
            // Transcribe audio
            const transcript = await transcribeAudio(
              mediaData.buffer, 
              mediaData.mimeType
            );
            
            if (transcript) {
              console.log('Transcript:', transcript);
              
              // Update raw_text with transcript
              raw_text = transcript;
              
              // Update inquiry with transcript
              await supabase
                .from('inquiries')
                .update({ 
                  raw_text: transcript,
                  voice_url: voice_url
                })
                .eq('id', savedInquiry.id);
              
              // Extract inquiry from transcript using Gemini
              extraction = await extractFromText(transcript);
              console.log('Extraction from voice:', JSON.stringify(extraction, null, 2));
            } else {
              console.log('Transcription failed or returned empty');
            }
          }
        }

        // Save deal if extraction succeeded
        let deal = null;
        if (extraction && !extraction.error) {
          // Update inquiry with extraction result
          await supabase
            .from('inquiries')
            .update({ 
              ai_extraction_json: extraction,
              overall_confidence: extraction.overall_confidence,
              status: extraction.overall_confidence >= 0.85 ? 'processed' : 'review'
            })
            .eq('id', savedInquiry.id);

          // Save deal + line items
          deal = await saveDeal(savedInquiry.id, extraction, senderPhone, employeeId);

          // --- KRA 2 NEW CUSTOMER CHECK ---
          if (deal && deal.customer_name) {
            const { checkAndLogNewCustomer } = require('./supabase');
            await checkAndLogNewCustomer(deal, senderPhone);
          }
          // --- END KRA 2 CHECK ---
        }

        // Build smart reply based on extraction
        let replyMessage;
        if (deal && extraction && extraction.line_items && extraction.line_items.length > 0) {
          const itemSummary = extraction.line_items
            .map(item => `• ${item.sku_text}: ${item.quantity} ${item.unit}`)
            .join('\n');
          
          const confidence = Math.round((extraction.overall_confidence || 0) * 100);
          const status = extraction.overall_confidence >= 0.85 ? '✅ Auto-logged' : '⚠️ Needs review';
          
          replyMessage = `${status} - Deal #${deal.id.substring(0, 8)}\n\n` +
            `📋 *${extraction.inquiry_type === 'purchase_order' ? 'Purchase Order' : 'Inquiry'}*\n` +
            (extraction.customer?.name ? `🏢 Customer: ${extraction.customer.name}\n` : '') +
            (extraction.po_number ? `📄 PO: ${extraction.po_number}\n` : '') +
            `\n📦 Items:\n${itemSummary}\n` +
            (extraction.total_amount ? `\n💰 Total: ₹${extraction.total_amount.toLocaleString('en-IN')}\n` : '') +
            (extraction.delivery_date ? `📅 Delivery: ${extraction.delivery_date}\n` : '') +
            `\n🎯 Confidence: ${confidence}%`;
        } else {
          if (messageType === 'audio' && !extraction) {
            replyMessage = `Voice note received but transcription failed. Please send as text.`;
          } else {
            replyMessage = `✅ Received! Reference: ${messageId.substring(0, 8)}\nWe have logged your message.`;
          }
        }
        // --- END GEMINI EXTRACTION ---

        // Send WhatsApp reply
        await sendTextMessage(senderPhone, replyMessage);

      } else {
        console.log("No messages in changes (received status update).");
      }
    }
  } catch (error) {
    console.error("Error processing incoming webhook POST:", error);
  } finally {
    // Meta requires a 200 OK response within 5 seconds for all webhook requests
    res.status(200).send('EVENT_RECEIVED');
  }
});

module.exports = router;

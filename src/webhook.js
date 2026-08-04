const express = require('express');
const router = express.Router();
const { supabase, saveInquiry, saveDeal, getEmployeeByPhone } = require('./supabase');
const { sendTextMessage, downloadMedia } = require('./whatsapp');
const { extractFromText, extractFromImage, classifyIntent } = require('./gemini');
const { transcribeAudio } = require('./assemblyai');
const { isQuery, handleQuery } = require('./queryhandler');
const { handleFollowUpReply } = require('./kra3');
const { handleVisitLog } = require('./kra9');
const { handlePaymentUpdate } = require('./kra5');
const { isComplaintReport, isComplaintResolution, handleComplaintLog, handleComplaintResolution } = require('./kra8');
const { handleNewCustomerAnnouncement } = require('./kra2');

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

        // Remove surrounding quotes if typed by the salesperson (e.g. from copy-pasting test prompts)
        if (raw_text) {
          raw_text = raw_text.trim();
          if ((raw_text.startsWith('"') && raw_text.endsWith('"')) || 
              (raw_text.startsWith("'") && raw_text.endsWith("'"))) {
            raw_text = raw_text.substring(1, raw_text.length - 1).trim();
          }
        }

        // Truncate raw_text if it is extremely long to prevent LLM timeouts (Edge Case 4)
        if (raw_text && raw_text.length > 2000) {
          raw_text = raw_text.substring(0, 2000) + "... (truncated)";
        }

        // Check if sender is attempting salesperson actions but is unregistered (Edge Case 3)
        if (!employeeRecord) {
          const isSalespersonCommand = messageType === 'text';
            
          if (isSalespersonCommand) {
            console.log(`Unregistered salesperson attempt from phone: ${senderPhone}`);
            await sendTextMessage(
              senderPhone, 
              `⚠️ *Registration Warning*\n\n` +
              `Your phone number (+${senderPhone}) is not registered as an active salesperson in the system.\n\n` +
              `Please ask the Admin to add your WhatsApp number under the "Employees" list in the dashboard first.`
            );
            return;
          }
        }

        // --- GEMINI INTENT CLASSIFICATION (runs FIRST before saving to inquiries) ---
        // This routes KRA action messages immediately without polluting the inquiries table
        if (messageType === 'text' && raw_text && raw_text.length > 3) {

            const intent = await classifyIntent(raw_text);
            console.log('Routing based on intent:', intent.intent, '| customer:', intent.customer_name, '| confidence:', intent.confidence);

            // NEW CUSTOMER ACQUISITION → KRA 2
            if (intent.intent === 'new_customer' && intent.confidence >= 0.6) {
              const reply = await handleNewCustomerAnnouncement(intent.customer_name, senderPhone);
              await sendTextMessage(senderPhone, reply);
              return;
            }

            // VISIT LOG → KRA 9
            if (intent.intent === 'visit' && intent.confidence >= 0.6) {
              const visitReply = await handleVisitLog(raw_text, senderPhone);
              await sendTextMessage(senderPhone, visitReply);
              return;
            }

            // PAYMENT UPDATE → KRA 5
            if (intent.intent === 'payment' && intent.confidence >= 0.6) {
              const paymentReply = await handlePaymentUpdate(raw_text, senderPhone);
              await sendTextMessage(senderPhone, paymentReply);
              return;
            }

            // COMPLAINT RESOLUTION → KRA 8
            if (intent.intent === 'complaint_resolve' && intent.confidence >= 0.6) {
              const resolutionReply = await handleComplaintResolution(raw_text, senderPhone);
              await sendTextMessage(senderPhone, resolutionReply);
              return;
            }

            // COMPLAINT REPORT → KRA 7 + KRA 8
            if (intent.intent === 'complaint' && intent.confidence >= 0.6) {
              const complaintReply = await handleComplaintLog(raw_text, senderPhone);
              await sendTextMessage(senderPhone, complaintReply);
              return;
            }

            // FOLLOW-UP → KRA 3
            if (intent.intent === 'followup' && intent.confidence >= 0.6) {
              const followReply = await handleFollowUpReply(raw_text, senderPhone);
              if (followReply) {
                await sendTextMessage(senderPhone, followReply);
                return;
              }
              // handleFollowUpReply returned null (no keyword match) — log directly
              const customerName = intent.customer_name || null;
              await supabase.from('kra_logs').insert({
                salesperson_phone: senderPhone,
                kra_number: 3,
                kra_type: 'customer_retention',
                description: `Follow-up: ${raw_text}`,
                customer_name: customerName,
                month: new Date().getMonth() + 1,
                year: new Date().getFullYear()
              });
              await sendTextMessage(senderPhone,
                `🔄 *KRA 3 - Follow-up Logged*\n\n` +
                (customerName ? `Customer: ${customerName}\n` : '') +
                `Status: Follow-up recorded\n\nLogged to KRA 3 ✅`
              );
              return;
            }

            // QUERY → show stats
            if (intent.intent === 'query' && intent.confidence >= 0.6) {
              const queryReply = await handleQuery(raw_text, senderPhone);
              await sendTextMessage(senderPhone, queryReply);
              return;
            }

            // intent === 'inquiry' or 'unknown' → fall through to Gemini extraction below
            console.log('Intent is inquiry/unknown — proceeding to extraction pipeline...');
        }
        // --- END GEMINI INTENT CLASSIFICATION ---

        // Only actual sales inquiries/POs reach here
        // Apply duplicate check only for inquiry messages
        if (raw_text) {
          const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
          const { data: duplicateInquiries } = await supabase
            .from('inquiries')
            .select('id, created_at')
            .eq('salesperson_phone', senderPhone)
            .eq('raw_text', raw_text)
            .gte('created_at', oneHourAgo);

          if (duplicateInquiries && duplicateInquiries.length > 0) {
            console.log('Duplicate inquiry text detected in the last 1 hour. Skipping processing.');
            await sendTextMessage(senderPhone, `⚠️ *Duplicate message ignored* - This inquiry was already received and processed recently.`);
            return;
          }
        }

        // Save raw inquiry data to Supabase
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

        // --- GEMINI EXTRACTION ---
        let extraction = null;
        let mediaDownloadFailed = false;

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
          } else {
            mediaDownloadFailed = true;
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
          } else {
            mediaDownloadFailed = true;
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
          } else {
            mediaDownloadFailed = true;
          }
        }

        // Save deal if extraction succeeded and it is a valid inquiry or PO
        let deal = null;
        if (extraction && !extraction.error && extraction.inquiry_type && extraction.inquiry_type !== 'unknown') {
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
          if (mediaDownloadFailed) {
            replyMessage = `⚠️ *Download Error*\n\n` +
              `Failed to download the attachment from WhatsApp. Please check the file and try sending it again.`;
          } else if (messageType === 'audio' && !extraction) {
            replyMessage = `Voice note received but transcription failed. Please send as text.`;
          } else {
            const cleanRef = messageId.replace('wamid.', '').substring(0, 10);
            replyMessage = `✅ *Inquiry Received*\n\n` +
              `Logged by: *${employeeRecord?.name || senderName}*\n` +
              `Reference: ${cleanRef}\n\n` +
              `We have logged your message.`;
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

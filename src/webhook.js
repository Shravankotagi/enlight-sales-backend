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

// Dedicated Specialized AI Agents
const { processSalesMessage, processSalesImage } = require('./agents/salesAgent');
const { processPaymentMessage, processPaymentImage } = require('./agents/paymentAgent');
const { processCustomerMessage } = require('./agents/customerAgent');
const { processComplaintMessage } = require('./agents/complaintAgent');
const { processVisitMessage } = require('./agents/visitAgent');
const { processRetentionMessage } = require('./agents/retentionAgent');

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

        // --- GEMINI INTENT CLASSIFICATION (semantic routing) ---
        if (messageType === 'text' && raw_text && raw_text.length >= 2) {
          const intent = await classifyIntent(raw_text);

          // Low confidence — ask for clarification instead of guessing
          if (intent.confidence < 0.5 && intent.intent === 'unknown') {
            await sendTextMessage(
              senderPhone,
              `🤔 Samajh nahi aaya. Kya aap thoda aur detail mein bata sakte hain?\n\n` +
                `For example:\n` +
                `• Deal update ke liye: "ABC ka deal won hua"\n` +
                `• Payment ke liye: "Supreme ne 50000 diya"\n` +
                `• Visit ke liye: "Aaj Mehta ke yahan gaya"`,
            );
            return;
          }

          switch (intent.intent) {
            case 'greeting': {
              const empName = employeeRecord ? employeeRecord.name : senderName;
              await sendTextMessage(
                senderPhone,
                `👋 *Hello ${empName}!*\n\nEnlight Sales Bot ready hai. Kya update karna hai?\n\n` +
                  `• Deal update, payment, visit, complaint — sab yahan log hoga ✅`,
              );
              return;
            }

            case 'stage_update': {
              const salesReply = await processSalesMessage(
                raw_text,
                senderPhone,
              );
              await sendTextMessage(senderPhone, salesReply);
              return;
            }

            case 'new_customer': {
              const customerReply = await processCustomerMessage(
                raw_text,
                senderPhone,
              );
              await sendTextMessage(senderPhone, customerReply);
              return;
            }

            case 'visit': {
              const visitReply = await processVisitMessage(
                raw_text,
                senderPhone,
              );
              await sendTextMessage(senderPhone, visitReply);
              return;
            }

            case 'payment': {
              const paymentReply = await processPaymentMessage(
                raw_text,
                senderPhone,
              );
              await sendTextMessage(senderPhone, paymentReply);
              return;
            }

            case 'complaint':
            case 'complaint_resolve': {
              const complaintReply = await processComplaintMessage(
                raw_text,
                senderPhone,
              );
              await sendTextMessage(senderPhone, complaintReply);
              return;
            }

            case 'followup': {
              const retentionReply = await processRetentionMessage(
                raw_text,
                senderPhone,
              );
              await sendTextMessage(senderPhone, retentionReply);
              return;
            }

            case 'query': {
              const queryReply = await handleQuery(raw_text, senderPhone);
              await sendTextMessage(senderPhone, queryReply);
              return;
            }

            case 'inquiry':
            default:
              // Fall through to extraction pipeline
              console.log(
                'Intent is inquiry/unknown — proceeding to extraction...',
              );
              break;
          }
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
        } else if ((messageType === 'image' || messageType === 'document') && media_urls.length > 0) {
          const mediaId = media_urls[0];
          const mediaData = await downloadMedia(mediaId);
          console.log('Media download result:', mediaData ? 'success' : 'failed');

          if (mediaData && mediaData.buffer) {
            const isPaymentKeyword = raw_text && (
              raw_text.toLowerCase().includes('payment') ||
              raw_text.toLowerCase().includes('paid') ||
              raw_text.toLowerCase().includes('receipt') ||
              raw_text.toLowerCase().includes('upi') ||
              raw_text.toLowerCase().includes('advance')
            );

            if (isPaymentKeyword) {
              // Route to Payment Collection Vision Agent (KRA 5)
              const paymentVisionReply = await processPaymentImage(mediaData.buffer, mediaData.mimeType, senderPhone);
              await sendTextMessage(senderPhone, paymentVisionReply);
              return;
            } else {
              // Route to Sales & PO Vision Agent (KRA 1 & Zoho Bigin)
              const salesVisionReply = await processSalesImage(mediaData.buffer, mediaData.mimeType, senderPhone);
              await sendTextMessage(senderPhone, salesVisionReply);
              return;
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
            .map((item) => {
              const rateStr = item.rate && item.rate > 0 ? ` @ ₹${Number(item.rate).toLocaleString('en-IN')}/MT` : '';
              const amtStr = item.amount && item.amount > 0 ? `: ₹${Number(item.amount).toLocaleString('en-IN')}` : '';
              return `• ${item.sku_text || 'Steel'} (${item.quantity} ${item.unit || 'MT'}${rateStr})${amtStr}`;
            })
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

const axios = require('axios');
const https = require('https');

// Force IPv4 (family: 4) to prevent IPv6 socket timeouts on Railway/cloud hosts
const httpsAgent = new https.Agent({
  keepAlive: true,
  family: 4,
  timeout: 15000
});

/**
 * Sends a text message to a user on WhatsApp via Meta Cloud API with retries and IPv4 binding.
 * @param {string} to - The recipient's phone number with country code.
 * @param {string} message - The text message body.
 */
async function sendTextMessage(to, message) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.error("Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID in environment variables");
    return null;
  }

  const url = `${process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v18.0'}/${phoneNumberId}/messages`;

  // Retry up to 3 times for network robustness
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.post(
        url,
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: to,
          type: "text",
          text: { body: message }
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000,
          httpsAgent
        }
      );

      console.log(`Successfully sent WhatsApp message to ${to} (attempt ${attempt}). Message ID: ${response.data.messages[0].id}`);
      return response.data;
    } catch (error) {
      console.error(`WhatsApp send error (attempt ${attempt}/3):`, error.message);
      if (attempt === 3) {
        console.error('FULL SEND ERROR details:', JSON.stringify(error.response?.data || error.message, null, 2));
      } else {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }
  return null;
}

/**
 * Downloads media from Meta Cloud API with retries and IPv4 binding.
 * @param {string} mediaId - The WhatsApp media ID.
 * @returns {Promise<{ buffer: Buffer, mimeType: string }|null>}
 */
async function downloadMedia(mediaId) {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const baseUrl = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v18.0';

    // Step 1: Get media URL from Meta API
    const metaResponse = await axios.get(
      `${baseUrl}/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
        httpsAgent
      }
    );

    const mediaUrl = metaResponse.data.url;
    const mimeType = metaResponse.data.mime_type;

    console.log('Media URL retrieved:', mediaUrl);

    // Step 2: Download the actual file
    const fileResponse = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: 20000,
      httpsAgent
    });

    const buffer = Buffer.from(fileResponse.data);
    console.log('Media downloaded successfully, size:', buffer.length, 'bytes');

    return { buffer, mimeType };
  } catch (error) {
    console.error('downloadMedia error:', error.message);
    return null;
  }
}

module.exports = {
  sendTextMessage,
  downloadMedia
};

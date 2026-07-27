const axios = require('axios');

/**
 * Sends a text message to a user on WhatsApp via Meta Cloud API.
 * @param {string} to - The recipient's phone number with country code.
 * @param {string} message - The text message body.
 */
async function sendTextMessage(to, message) {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      throw new Error("Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID in environment variables");
    }

    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
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
        }
      }
    );

    console.log(`Successfully sent WhatsApp message to ${to}. Message ID: ${response.data.messages[0].id}`);
    return response.data;
  } catch (error) {
    console.error('FULL SEND ERROR:', JSON.stringify(error.response?.data, null, 2));
    console.error('Sending to:', to);
    console.error('Token used:', process.env.WHATSAPP_TOKEN?.substring(0, 30));
    console.error('Phone Number ID:', process.env.WHATSAPP_PHONE_NUMBER_ID);
    throw error;
  }
}

/**
 * Downloads media from Meta Cloud API.
 * @param {string} mediaId - The WhatsApp media ID.
 * @returns {Promise<{ buffer: Buffer, mimeType: string }|null>}
 */
async function downloadMedia(mediaId) {
  try {
    // Step 1: Get media URL from Meta API
    const metaResponse = await axios.get(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
        }
      }
    );

    const mediaUrl = metaResponse.data.url;
    const mimeType = metaResponse.data.mime_type;

    console.log('Media URL retrieved:', mediaUrl);
    console.log('MIME type:', mimeType);

    // Step 2: Download the actual file
    const fileResponse = await axios.get(mediaUrl, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
      },
      responseType: 'arraybuffer'
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

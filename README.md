# Enlight Metals WhatsApp Sales Bot

This is a standalone Express.js webhook server that:
1. Receives WhatsApp messages via Meta Cloud API webhook.
2. Extracts message content (text, image, audio, document).
3. Saves raw inquiry details to a Supabase database.
4. Replies to the sender on WhatsApp confirming receipt of their inquiry.

## Tech Stack
- Node.js + Express
- `@supabase/supabase-js` (database)
- `axios` (WhatsApp API calls)
- `dotenv` (environment variables configuration)
- `@google/generative-ai` (Gemini integration - stubbed for Sprint 2)

## Setup Instructions

1. **Install dependencies**:
   ```bash
   cd bot
   npm install
   ```

2. **Configure Environment Variables**:
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Fill in the required credentials in `.env`. Note that if you already have a global `.env` file in the parent folder, you can copy or reference its values.

3. **Run the Server**:
   - For development (with auto-reload):
     ```bash
     npm run dev
     ```
   - For production:
     ```bash
     npm start
     ```

## Exposing the Webhook Locally

Since Meta needs a publicly accessible HTTPS URL to send webhook events, you can use **ngrok**:

1. Run ngrok on port 3000:
   ```bash
   ngrok http 3000
   ```
2. Copy the forwarding HTTPS URL provided by ngrok (e.g., `https://your-ngrok-url.ngrok-free.app`).
3. Your webhook URL format for Meta configuration will be:
   `https://your-ngrok-url.ngrok-free.app/webhook`
4. Set the **Verify Token** to the same value as `WHATSAPP_VERIFY_TOKEN` in your `.env`.

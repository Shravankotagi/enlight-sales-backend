import { config } from 'dotenv';
config();

const params = new URLSearchParams({
  refresh_token: process.env.ZOHO_REFRESH_TOKEN,
  client_id: process.env.ZOHO_CLIENT_ID,
  client_secret: process.env.ZOHO_CLIENT_SECRET,
  grant_type: 'refresh_token'
});

// Step 1: Get token
const tokenRes = await fetch('https://accounts.zoho.in/oauth/v2/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: params.toString()
});
const tokenData = await tokenRes.json();
console.log('Token response:', JSON.stringify(tokenData));

const token = tokenData.access_token;
if (!token) {
  console.log('No token — stopping');
  process.exit(1);
}

// Step 2: Try creating a deal
const deal = {
  data: [{
    Deal_Name: 'Test Deal from Enlight Bot',
    Stage: 'Qualification',
    Amount: 100000,
    Contact_Name: 'Dynamic Industries',
    Closing_Date: '2026-08-31'
  }]
};

const dealRes = await fetch('https://www.zohoapis.in/bigin/v1/Deals', {
  method: 'POST',
  headers: {
    Authorization: `Zoho-oauthtoken ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(deal)
});

const dealData = await dealRes.json();
console.log('Deal response status:', dealRes.status);
console.log('Deal response:', JSON.stringify(dealData, null, 2));
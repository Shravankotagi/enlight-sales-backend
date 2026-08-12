require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const { extractFromImage } = require('./src/gemini');

async function test() {
  // Read a local image file for testing
  const imagePath = path.join(__dirname, 'test-po.jpg');
  
  if (!fs.existsSync(imagePath)) {
    console.log('No test-po.jpg found. Creating test with sample text instead...');
    // Fallback: test with text that simulates a PO
    const { extractFromText } = require('./src/gemini');
    const poText = `
      PURCHASE ORDER
      PO No: 26-27/MPO/471
      Date: 03/06/2026
      Vendor: Enlight Metals Private Limited
      Customer: Dynamic Industries
      
      Item 1: Sheet 8MM THK MS-E250, 8x6000x1500
      Qty: 28260 KGS, Rate: 60/KG, Amount: 16,95,600
      
      Item 2: Sheet 10MM THK MS-E250, 10x6000x1500  
      Qty: 30379.5 KGS, Rate: 60/KG, Amount: 18,22,770
      
      Payment: 45 Days
      Total: 41,51,676.60
    `;
    const result = await extractFromText(poText);
    console.log('PO Extraction Result:', JSON.stringify(result, null, 2));
    return;
  }

  // If test-po.jpg exists, test with actual image
  const buffer = fs.readFileSync(imagePath);
  console.log('Testing image extraction with:', imagePath);
  console.log('File size:', buffer.length, 'bytes');
  
  const result = await extractFromImage(buffer, 'image/jpeg');
  console.log('Image Extraction Result:', JSON.stringify(result, null, 2));
}

test().catch(console.error);

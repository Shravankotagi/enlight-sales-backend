const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function formatIndianCurrency(amount, allowDecimals = true) {
  const num = Number(amount) || 0;
  if (num === 0) return '0.00';
  const parts = num.toFixed(2).split('.');
  let integerPart = parts[0];
  const decimalPart = parts[1];
  let lastThree = integerPart.substring(integerPart.length - 3);
  const otherNumbers = integerPart.substring(0, integerPart.length - 3);
  if (otherNumbers !== '') lastThree = ',' + lastThree;
  const res = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;
  return allowDecimals ? res + '.' + decimalPart : res;
}

function numberToWordsINR(amount) {
  const words = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  const tens = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety',
  ];

  function convertTwoDigits(n) {
    if (n < 20) return words[n];
    return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + words[n % 10] : '');
  }

  function convertThreeDigits(n) {
    let str = '';
    if (Math.floor(n / 100) > 0) {
      str += words[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n > 0) {
      str += convertTwoDigits(n);
    }
    return str.trim();
  }

  const num = Math.floor(amount);
  if (num === 0) return 'Zero';

  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const remainder = num % 1000;

  let res = '';
  if (crore > 0) res += convertThreeDigits(crore) + ' Crore ';
  if (lakh > 0) res += convertThreeDigits(lakh) + ' Lakh, ';
  if (thousand > 0) res += convertThreeDigits(thousand) + ' Thousand, ';
  if (remainder > 0) res += convertThreeDigits(remainder) + ' ';

  return res.trim();
}

function generateSamplePO(outputPath) {
  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  const fontRegPath = path.join(
    __dirname,
    '../assets/fonts/NotoSans-Regular.ttf',
  );
  const fontBoldPath = path.join(
    __dirname,
    '../assets/fonts/NotoSans-Bold.ttf',
  );

  let fontReg = 'Helvetica';
  let fontBold = 'Helvetica-Bold';
  if (fs.existsSync(fontRegPath) && fs.existsSync(fontBoldPath)) {
    try {
      doc.registerFont('NotoSans', fontRegPath);
      doc.registerFont('NotoSans-Bold', fontBoldPath);
      fontReg = 'NotoSans';
      fontBold = 'NotoSans-Bold';
      doc.font('NotoSans');
    } catch (e) {}
  }

  doc.pipe(fs.createWriteStream(outputPath));

  const leftX = 30;
  const rightX = 565.28;
  const contentW = rightX - leftX; // 535.28

  // Header Box
  let currY = 30;
  doc
    .rect(leftX, currY, contentW, 22)
    .strokeColor('#000000')
    .lineWidth(1)
    .stroke();
  doc
    .font(fontBold)
    .fontSize(12)
    .fillColor('#000000')
    .text('Purchase Order', leftX, currY + 5, {
      width: contentW,
      align: 'center',
    });
  currY += 22;

  // 4-Quadrant Info Box
  const boxHeight = 160;
  doc
    .rect(leftX, currY, contentW, boxHeight)
    .strokeColor('#000000')
    .lineWidth(1)
    .stroke();
  // Vertical divider
  const midX = leftX + contentW / 2;
  doc
    .moveTo(midX, currY)
    .lineTo(midX, currY + boxHeight)
    .strokeColor('#000000')
    .lineWidth(1)
    .stroke();
  // Horizontal divider
  const midY = currY + 80;
  doc
    .moveTo(leftX, midY)
    .lineTo(rightX, midY)
    .strokeColor('#000000')
    .lineWidth(1)
    .stroke();

  // Quad 1 (Top Left): Invoice To
  doc
    .font(fontBold)
    .fontSize(8)
    .fillColor('#000000')
    .text('Invoice To :', leftX + 6, currY + 5);
  doc
    .font(fontBold)
    .fontSize(8.5)
    .text('KALYANI INFRASTRUCTURES PVT. LTD.', leftX + 6, currY + 15);
  doc.font(fontReg).fontSize(7.5).fillColor('#222222');
  doc.text(
    'Kalyani Tech Park, Wing B, Survey No. 48/2, Pune-Bangalore Highway,',
    leftX + 6,
    currY + 26,
    { width: 250 },
  );
  doc.text('Baner, Pune, Maharashtra, State Code: 27', leftX + 6, currY + 36);
  doc.text('PIN: 411045', leftX + 6, currY + 46);
  doc.text('India', leftX + 6, currY + 56);
  doc
    .font(fontBold)
    .fontSize(7.5)
    .text('GSTIN: 27AAACK8821M1ZY', leftX + 6, currY + 67);

  // Quad 2 (Top Right): Order Info
  doc
    .font(fontBold)
    .fontSize(8)
    .fillColor('#000000')
    .text('Order No. : ', midX + 6, currY + 5, { continued: true })
    .font(fontReg)
    .text('PO-26-27-01042 | Date : 24-08-2026');
  doc
    .font(fontBold)
    .fontSize(7.5)
    .text('PR No. : ', midX + 6, currY + 17, { continued: true })
    .font(fontReg)
    .text('MAT-MR-2026-08831');
  doc
    .font(fontBold)
    .fontSize(7.5)
    .text('Delivery Schedule : ', midX + 6, currY + 28, { continued: true })
    .font(fontReg)
    .text('28-08-2026');
  doc
    .font(fontBold)
    .fontSize(7.5)
    .text('Purchase Purpose : ', midX + 6, currY + 39, { continued: true })
    .font(fontReg)
    .text('Industrial Heavy Fabrication');
  doc
    .font(fontBold)
    .fontSize(7.5)
    .text('Division : ', midX + 6, currY + 50, { continued: true })
    .font(fontReg)
    .text('Structural Steel Division');
  doc
    .font(fontBold)
    .fontSize(7.5)
    .text('Payment Terms : ', midX + 6, currY + 61, { continued: true })
    .font(fontReg)
    .text('30 Days PDC against Invoice Date');

  // Quad 3 (Bottom Left): Supplier
  doc
    .font(fontBold)
    .fontSize(8)
    .fillColor('#000000')
    .text('Supplier :', leftX + 6, midY + 5);
  doc
    .font(fontBold)
    .fontSize(8.5)
    .text('Enlight Metals Private Limited', leftX + 6, midY + 15);
  doc.font(fontReg).fontSize(7.5).fillColor('#222222');
  doc.text(
    'Shop No 606 SN 272, 6th Floor, Clover Hills Plaza',
    leftX + 6,
    midY + 26,
  );
  doc.text('NIBM UNDRI Road,', leftX + 6, midY + 36);
  doc.text('Pune', leftX + 6, midY + 46);
  doc.text(
    'Maharashtra, State Code: 27 | PIN: 411048 | India',
    leftX + 6,
    midY + 56,
  );
  doc
    .font(fontBold)
    .fontSize(7.5)
    .text('GSTIN: 27AAICE5263E1ZN', leftX + 6, midY + 67);

  // Quad 4 (Bottom Right): Delivery Address
  doc
    .font(fontBold)
    .fontSize(8)
    .fillColor('#000000')
    .text('Delivery Address :', midX + 6, midY + 5);
  doc.font(fontReg).fontSize(7.5).fillColor('#222222');
  doc.text(
    'Site Yard No. 12, Phase II Industrial Zone, Chakan MIDC,',
    midX + 6,
    midY + 16,
    { width: 250 },
  );
  doc.text('Taluka Khed, Pune', midX + 6, midY + 26);
  doc.text(
    'Maharashtra, State Code: 27 | PIN: 410501 | India',
    midX + 6,
    midY + 36,
  );
  doc
    .font(fontBold)
    .fontSize(7.5)
    .text('GSTIN: 27AAACK8821M1ZY', midX + 6, midY + 57);

  currY += boxHeight;

  // Line Items Table
  const colW = {
    sr: 35,
    desc: 220,
    qty: 60,
    uom: 45,
    rate: 75,
    amount: 100.28,
  };

  // Table Header
  const thH = 20;
  doc
    .rect(leftX, currY, contentW, thH)
    .strokeColor('#000000')
    .lineWidth(1)
    .stroke();
  doc.font(fontBold).fontSize(8).fillColor('#000000');

  let cX = leftX;
  doc.text('Sr No.', cX, currY + 5, { width: colW.sr, align: 'center' });
  cX += colW.sr;
  doc
    .moveTo(cX, currY)
    .lineTo(cX, currY + thH)
    .stroke();

  doc.text('Description', cX + 6, currY + 5, { width: colW.desc - 6 });
  cX += colW.desc;
  doc
    .moveTo(cX, currY)
    .lineTo(cX, currY + thH)
    .stroke();

  doc.text('Qty', cX, currY + 5, { width: colW.qty, align: 'center' });
  cX += colW.qty;
  doc
    .moveTo(cX, currY)
    .lineTo(cX, currY + thH)
    .stroke();

  doc.text('UOM', cX, currY + 5, { width: colW.uom, align: 'center' });
  cX += colW.uom;
  doc
    .moveTo(cX, currY)
    .lineTo(cX, currY + thH)
    .stroke();

  doc.text('Rate', cX, currY + 5, { width: colW.rate - 6, align: 'right' });
  cX += colW.rate;
  doc
    .moveTo(cX, currY)
    .lineTo(cX, currY + thH)
    .stroke();

  doc.text('Amount', cX, currY + 5, { width: colW.amount - 6, align: 'right' });

  currY += thH;

  const items = [
    {
      sr: 1,
      title: 'M.S Flat 150x6mmx6m',
      sub: 'IS:2062 (NEED TC COPY)',
      qty: 5000.0,
      uom: 'Kg',
      rate: 53.0,
      amount: 265000.0,
    },
    {
      sr: 2,
      title: 'M.S. Sheet 1250 x 2500 x 3mm',
      sub: 'COIL E-350 BR\nNEED TC',
      qty: 12000.0,
      uom: 'Kg',
      rate: 64.0,
      amount: 768000.0,
    },
  ];

  items.forEach((it) => {
    const rowH = 40;
    doc
      .rect(leftX, currY, contentW, rowH)
      .strokeColor('#000000')
      .lineWidth(0.5)
      .stroke();

    let xPos = leftX;
    doc
      .font(fontReg)
      .fontSize(8)
      .fillColor('#000000')
      .text(String(it.sr), xPos, currY + 8, {
        width: colW.sr,
        align: 'center',
      });
    xPos += colW.sr;
    doc
      .moveTo(xPos, currY)
      .lineTo(xPos, currY + rowH)
      .strokeColor('#000000')
      .lineWidth(0.5)
      .stroke();

    doc
      .font(fontBold)
      .fontSize(8)
      .text(it.title, xPos + 6, currY + 6, { width: colW.desc - 10 });
    doc
      .font(fontReg)
      .fontSize(7.5)
      .fillColor('#444444')
      .text(it.sub, xPos + 6, currY + 17, { width: colW.desc - 10 });
    doc.fillColor('#000000');
    xPos += colW.desc;
    doc
      .moveTo(xPos, currY)
      .lineTo(xPos, currY + rowH)
      .strokeColor('#000000')
      .lineWidth(0.5)
      .stroke();

    doc
      .font(fontReg)
      .fontSize(8)
      .text(it.qty.toFixed(1), xPos, currY + 8, {
        width: colW.qty,
        align: 'center',
      });
    xPos += colW.qty;
    doc
      .moveTo(xPos, currY)
      .lineTo(xPos, currY + rowH)
      .strokeColor('#000000')
      .lineWidth(0.5)
      .stroke();

    doc
      .font(fontReg)
      .fontSize(8)
      .text(it.uom, xPos, currY + 8, { width: colW.uom, align: 'center' });
    xPos += colW.uom;
    doc
      .moveTo(xPos, currY)
      .lineTo(xPos, currY + rowH)
      .strokeColor('#000000')
      .lineWidth(0.5)
      .stroke();

    doc
      .font(fontReg)
      .fontSize(8)
      .text('Rs. ' + it.rate.toFixed(2), xPos, currY + 8, {
        width: colW.rate - 6,
        align: 'right',
      });
    xPos += colW.rate;
    doc
      .moveTo(xPos, currY)
      .lineTo(xPos, currY + rowH)
      .strokeColor('#000000')
      .lineWidth(0.5)
      .stroke();

    doc
      .font(fontReg)
      .fontSize(8)
      .text('Rs. ' + formatIndianCurrency(it.amount), xPos, currY + 8, {
        width: colW.amount - 6,
        align: 'right',
      });

    currY += rowH;
  });

  // Totals Block
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const subTotal = items.reduce((s, i) => s + i.amount, 0);
  const sgst = subTotal * 0.09;
  const cgst = subTotal * 0.09;
  const grandTotal = subTotal + sgst + cgst;

  // Total Qty & Subtotal Row
  const rH = 15;
  doc
    .rect(leftX, currY, contentW, rH)
    .strokeColor('#000000')
    .lineWidth(0.5)
    .stroke();
  doc
    .font(fontBold)
    .fontSize(8)
    .text('Total Qty', leftX + colW.sr + colW.desc - 80, currY + 3, {
      width: 75,
      align: 'right',
    });
  doc
    .moveTo(leftX + colW.sr + colW.desc, currY)
    .lineTo(leftX + colW.sr + colW.desc, currY + rH)
    .stroke();
  doc
    .font(fontReg)
    .fontSize(8)
    .text(totalQty.toFixed(1), leftX + colW.sr + colW.desc, currY + 3, {
      width: colW.qty,
      align: 'center',
    });

  doc
    .moveTo(leftX + colW.sr + colW.desc + colW.qty + colW.uom, currY)
    .lineTo(leftX + colW.sr + colW.desc + colW.qty + colW.uom, currY + rH)
    .stroke();
  doc
    .font(fontBold)
    .fontSize(8)
    .text('Total', leftX + colW.sr + colW.desc + colW.qty, currY + 3, {
      width: colW.uom + colW.rate - 6,
      align: 'right',
    });
  doc
    .moveTo(rightX - colW.amount, currY)
    .lineTo(rightX - colW.amount, currY + rH)
    .stroke();
  doc
    .font(fontReg)
    .fontSize(8)
    .text(
      'Rs. ' + formatIndianCurrency(subTotal),
      rightX - colW.amount,
      currY + 3,
      { width: colW.amount - 6, align: 'right' },
    );
  currY += rH;

  // SGST Row
  doc
    .rect(leftX, currY, contentW, rH)
    .strokeColor('#000000')
    .lineWidth(0.5)
    .stroke();
  doc
    .font(fontBold)
    .fontSize(8)
    .text('SGST @ 9.0', rightX - colW.amount - colW.rate, currY + 3, {
      width: colW.rate - 6,
      align: 'right',
    });
  doc
    .moveTo(rightX - colW.amount, currY)
    .lineTo(rightX - colW.amount, currY + rH)
    .stroke();
  doc
    .font(fontReg)
    .fontSize(8)
    .text(
      'Rs. ' + formatIndianCurrency(sgst),
      rightX - colW.amount,
      currY + 3,
      { width: colW.amount - 6, align: 'right' },
    );
  currY += rH;

  // CGST Row
  doc
    .rect(leftX, currY, contentW, rH)
    .strokeColor('#000000')
    .lineWidth(0.5)
    .stroke();
  doc
    .font(fontBold)
    .fontSize(8)
    .text('CGST @ 9.0', rightX - colW.amount - colW.rate, currY + 3, {
      width: colW.rate - 6,
      align: 'right',
    });
  doc
    .moveTo(rightX - colW.amount, currY)
    .lineTo(rightX - colW.amount, currY + rH)
    .stroke();
  doc
    .font(fontReg)
    .fontSize(8)
    .text(
      'Rs. ' + formatIndianCurrency(cgst),
      rightX - colW.amount,
      currY + 3,
      { width: colW.amount - 6, align: 'right' },
    );
  currY += rH;

  // Grand Total Row
  doc
    .rect(leftX, currY, contentW, rH)
    .strokeColor('#000000')
    .lineWidth(0.5)
    .stroke();
  doc
    .font(fontBold)
    .fontSize(8)
    .text('Grand Total', rightX - colW.amount - colW.rate, currY + 3, {
      width: colW.rate - 6,
      align: 'right',
    });
  doc
    .moveTo(rightX - colW.amount, currY)
    .lineTo(rightX - colW.amount, currY + rH)
    .stroke();
  doc
    .font(fontBold)
    .fontSize(8)
    .text(
      'Rs. ' + formatIndianCurrency(grandTotal),
      rightX - colW.amount,
      currY + 3,
      { width: colW.amount - 6, align: 'right' },
    );
  currY += rH;

  // Amount in Words
  currY += 5;
  const words = numberToWordsINR(grandTotal);
  doc
    .font(fontBold)
    .fontSize(8)
    .text('Amount in Words: ', leftX, currY, { continued: true })
    .font(fontReg)
    .text('INR ' + words + ' only.');
  currY += 14;

  // Terms & Conditions
  doc.font(fontBold).fontSize(8).text('Terms & Condition:', leftX, currY);
  currY += 11;

  const terms = [
    'Purchase Order : In Scope of Supplier.',
    'Payment Terms : As per mutually agreed. ( Mentioned Above)',
    'Delivery Schedule : immediate',
    'Material Grade: ISI 2062',
    'Quality : As per ISI standard without any defect, Free from Rust ,Size Tolerance +/- 0.02%, Above Tolerance limit Material not to accept .',
    'Transportation, loading Charges Scope:-SUPPLIERS SCOPE',
    'Quantity: Variation in weight (+) (-) 50 KG will be acceptable against Mentioned PO Quantity.',
    'Delayed Delivery: Delayed delivery against committed date 2% delayed charges applicable against invoice value',
    'Delivery Documents With Vehicle: Original invoice Copy , E way Bill Copy, Weightily/Packing List, MTC report.',
    'PO Number mentioned mandatory in Invoice Copy, Challan Copy with Proper Shipping address & Billing address as per above given.',
    'In case Original invoice Copy not submitted along with Material ,3 days Allow to send Original copy In Head Office, If receive Original Copies after 3 Days ,Invoice not acceptable for further account process.',
    'All other terms & conditions will be Mandatory',
  ];

  doc.font(fontReg).fontSize(7.5).fillColor('#111111');
  terms.forEach((t) => {
    doc.text(t, leftX, currY, { width: contentW, lineGap: 1.5 });
    currY += doc.heightOfString(t, { width: contentW }) + 2.5;
  });

  // Footer GST TIN
  currY = Math.max(currY + 5, 750);
  doc
    .font(fontBold)
    .fontSize(7.5)
    .fillColor('#000000')
    .text('Company’s GST TIN No. : ', leftX, currY, { continued: true })
    .font(fontReg)
    .text('27AAACK8821M1ZY  27AAICE5263E1ZN');
  currY += 12;

  // Signature Box
  const sigH = 35;
  doc
    .rect(leftX, currY, contentW, sigH)
    .strokeColor('#000000')
    .lineWidth(1)
    .stroke();
  const colSig1 = leftX + 130;
  const colSig2 = leftX + 260;
  doc
    .moveTo(colSig1, currY)
    .lineTo(colSig1, currY + sigH)
    .stroke();
  doc
    .moveTo(colSig2, currY)
    .lineTo(colSig2, currY + sigH)
    .stroke();

  doc
    .font(fontBold)
    .fontSize(7.5)
    .text('Prepared By', leftX, currY + 4, { width: 130, align: 'center' });
  doc
    .font(fontBold)
    .fontSize(7.5)
    .text('Checked By', colSig1, currY + 4, { width: 130, align: 'center' });
  doc
    .font(fontBold)
    .fontSize(7.5)
    .text('For KALYANI INFRASTRUCTURES PVT. LTD.', colSig2, currY + 4, {
      width: contentW - 260,
      align: 'center',
    });
  doc
    .font(fontReg)
    .fontSize(7)
    .text('Authorised Signatory', colSig2, currY + 22, {
      width: contentW - 260,
      align: 'center',
    });

  doc.end();
}

if (!fs.existsSync('scripts')) {
  fs.mkdirSync('scripts');
}
const outPdf = path.join(process.cwd(), 'Sample_Purchase_Order.pdf');
generateSamplePO(outPdf);
console.log('Sample PO PDF successfully created at:', outPdf);

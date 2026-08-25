const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const outDir = path.resolve(__dirname, '../../test_inquiries');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function generatePDF1() {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const filePath = path.join(outDir, 'Inquiry_PDF_1_Dynamic_Engineering.pdf');
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Header Box / Brand
  doc.rect(40, 40, 515, 65).fillAndStroke('#1E293B', '#1E293B');
  doc
    .fillColor('#FFFFFF')
    .fontSize(16)
    .font('Helvetica-Bold')
    .text('DYNAMIC ENGINEERING WORKS PVT. LTD.', 55, 52);
  doc
    .fontSize(9)
    .font('Helvetica')
    .fillColor('#94A3B8')
    .text(
      'Plant: Plot No. C-14, Taloja MIDC Industrial Area, Navi Mumbai - 410208',
      55,
      72,
    );
  doc.text(
    'GSTIN: 27AABCD8899K1Z5 | Email: purchase@dynamicengg.co.in | Phone: +91 98201 44552',
    55,
    84,
  );

  // RFQ Title Banner
  doc.rect(40, 115, 515, 26).fillAndStroke('#F1F5F9', '#CBD5E1');
  doc
    .fillColor('#0F172A')
    .fontSize(11)
    .font('Helvetica-Bold')
    .text('REQUEST FOR QUOTATION (RFQ) / RATE INQUIRY', 55, 122);
  doc
    .fillColor('#64748B')
    .fontSize(9)
    .font('Helvetica')
    .text('Ref: DEW/RFQ/2026/089', 420, 122, { align: 'right', width: 120 });

  // Vendor & Inq Meta
  doc.rect(40, 150, 515, 75).stroke('#E2E8F0');
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .fillColor('#334155')
    .text('To (Supplier):', 50, 158);
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .fillColor('#0F172A')
    .text('Enlight Metals Private Limited', 50, 170);
  doc
    .font('Helvetica')
    .fillColor('#64748B')
    .text('Pune, Maharashtra, India', 50, 182);
  doc.text('Email: sales@enlightmetals.com', 50, 194);

  doc
    .font('Helvetica-Bold')
    .fillColor('#334155')
    .text('Inquiry Date:', 340, 158);
  doc.font('Helvetica').fillColor('#0F172A').text('24-Aug-2026', 420, 158);
  doc
    .font('Helvetica-Bold')
    .fillColor('#334155')
    .text('Delivery Location:', 340, 172);
  doc
    .font('Helvetica')
    .fillColor('#0F172A')
    .text('Taloja MIDC, Navi Mumbai', 420, 172);
  doc
    .font('Helvetica-Bold')
    .fillColor('#334155')
    .text('Payment Terms:', 340, 186);
  doc.font('Helvetica').fillColor('#0F172A').text('30 Days Credit', 420, 186);
  doc
    .font('Helvetica-Bold')
    .fillColor('#334155')
    .text('Required Delivery:', 340, 200);
  doc.font('Helvetica').fillColor('#0F172A').text('Within 10 Days', 420, 200);

  // Inquiry Note
  doc
    .fontSize(9.5)
    .font('Helvetica')
    .fillColor('#334155')
    .text(
      'Dear Sir,\nKindly provide your best commercial rates, applicable taxes, and delivery schedule for the following steel materials required for our ongoing fabrication project.',
      40,
      235,
      { width: 515, lineGap: 3 },
    );

  // Table Header
  const tableTop = 275;
  doc.rect(40, tableTop, 515, 22).fillAndStroke('#334155', '#334155');
  doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold');
  doc.text('Sr', 45, tableTop + 6, { width: 25, align: 'center' });
  doc.text('Material Description', 75, tableTop + 6, { width: 170 });
  doc.text('Dimensions / Size', 250, tableTop + 6, { width: 110 });
  doc.text('Grade / Make', 365, tableTop + 6, { width: 75, align: 'center' });
  doc.text('Qty', 445, tableTop + 6, { width: 45, align: 'right' });
  doc.text('Unit', 495, tableTop + 6, { width: 50, align: 'center' });

  const items = [
    {
      sr: 1,
      desc: 'MS Sheet (Hot Rolled)',
      dims: '5MM THK (1250 x 2500)',
      grade: 'IS 2062 E250',
      qty: '150',
      unit: 'Nos',
    },
    {
      sr: 2,
      desc: 'MS Sheet (Hot Rolled)',
      dims: '6MM THK (1250 x 2500)',
      grade: 'IS 2062 E250',
      qty: '100',
      unit: 'Nos',
    },
    {
      sr: 3,
      desc: 'HR Coil (Prime Quality)',
      dims: '3.15MM (1250 mm width)',
      grade: 'SAIL / JSW',
      qty: '12.00',
      unit: 'MT',
    },
    {
      sr: 4,
      desc: 'CR Sheet (Cold Rolled)',
      dims: '1.00MM (1000 x 2000)',
      grade: 'CRCA D/DD',
      qty: '220',
      unit: 'Nos',
    },
    {
      sr: 5,
      desc: 'MS Chequered Plate',
      dims: '4.50MM (1250 x 2500)',
      grade: 'Chequered E250',
      qty: '8.50',
      unit: 'MT',
    },
  ];

  let currentY = tableTop + 22;
  items.forEach((item, index) => {
    const bg = index % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
    doc.rect(40, currentY, 515, 24).fillAndStroke(bg, '#E2E8F0');
    doc.fillColor('#0F172A').fontSize(8.5).font('Helvetica');
    doc.text(String(item.sr), 45, currentY + 7, { width: 25, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .text(item.desc, 75, currentY + 7, { width: 170 });
    doc.font('Helvetica').text(item.dims, 250, currentY + 7, { width: 110 });
    doc.text(item.grade, 365, currentY + 7, { width: 75, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .text(item.qty, 445, currentY + 7, { width: 45, align: 'right' });
    doc
      .font('Helvetica')
      .text(item.unit, 495, currentY + 7, { width: 50, align: 'center' });
    currentY += 24;
  });

  // Terms & Conditions Block
  currentY += 25;
  doc.rect(40, currentY, 515, 95).stroke('#CBD5E1');
  doc.rect(40, currentY, 515, 18).fillAndStroke('#F1F5F9', '#CBD5E1');
  doc
    .fillColor('#334155')
    .fontSize(9)
    .font('Helvetica-Bold')
    .text('GENERAL COMMERCIAL INSTRUCTIONS:', 48, currentY + 5);

  doc.fillColor('#475569').fontSize(8.5).font('Helvetica');
  doc.text(
    '1. Rates should be quoted FOR Taloja MIDC delivery basis including freight and handling.',
    48,
    currentY + 24,
  );
  doc.text(
    '2. Please clearly specify GST percentage, HSN codes, and current loading/cutting charges if applicable.',
    48,
    currentY + 38,
  );
  doc.text(
    '3. Mill Test Certificate (MTC) with heat numbers is mandatory along with delivery dispatch.',
    48,
    currentY + 52,
  );
  doc.text(
    '4. Quotation validity must be minimum 7 days from the date of submission.',
    48,
    currentY + 66,
  );
  doc.text(
    '5. Preferred Steel Makers: SAIL / JSW / TATA / AMNS.',
    48,
    currentY + 80,
  );

  // Sign-off
  currentY += 120;
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .fillColor('#0F172A')
    .text('For DYNAMIC ENGINEERING WORKS PVT. LTD.', 40, currentY);
  doc
    .fontSize(8.5)
    .font('Helvetica')
    .fillColor('#64748B')
    .text('Authorised Signatory / Procurement Dept.', 40, currentY + 35);
  doc.text(
    'Contact Person: Rajesh Nair (Purchase Manager) | Mob: +91 98201 44552',
    40,
    currentY + 48,
  );

  doc.end();
}

function generatePDF2() {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const filePath = path.join(outDir, 'Inquiry_PDF_2_Rathi_Infra_Projects.pdf');
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Header Box / Brand
  doc.rect(40, 40, 515, 65).fillAndStroke('#0F766E', '#0F766E');
  doc
    .fillColor('#FFFFFF')
    .fontSize(16)
    .font('Helvetica-Bold')
    .text('RATHI INFRASTRUCTURE PROJECTS LTD.', 55, 52);
  doc
    .fontSize(9)
    .font('Helvetica')
    .fillColor('#CCFBF1')
    .text(
      'Project Office: Chakan Industrial Area Phase-II, Pune - 410501, Maharashtra',
      55,
      72,
    );
  doc.text(
    'GSTIN: 27AABCR1234F1Z9 | Email: tenders@rathiinfra.com | Direct: +91 94220 18877',
    55,
    84,
  );

  // RFQ Title Banner
  doc.rect(40, 115, 515, 26).fillAndStroke('#F0FDFA', '#99F6E4');
  doc
    .fillColor('#115E59')
    .fontSize(11)
    .font('Helvetica-Bold')
    .text('OFFICIAL PROCUREMENT INQUIRY / MATERIAL RFQ', 55, 122);
  doc
    .fillColor('#0F766E')
    .fontSize(9)
    .font('Helvetica')
    .text('Ref: RIPL/PROC/AUG-4421', 420, 122, { align: 'right', width: 120 });

  // Vendor & Inq Meta
  doc.rect(40, 150, 515, 75).stroke('#E2E8F0');
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .fillColor('#115E59')
    .text('To Supplier:', 50, 158);
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .fillColor('#0F172A')
    .text('Enlight Metals Private Limited', 50, 170);
  doc.font('Helvetica').fillColor('#64748B').text('Pune, Maharashtra', 50, 182);
  doc.text('Email: sales@enlightmetals.com', 50, 194);

  doc
    .font('Helvetica-Bold')
    .fillColor('#115E59')
    .text('Inquiry Date:', 340, 158);
  doc.font('Helvetica').fillColor('#0F172A').text('24-Aug-2026', 420, 158);
  doc
    .font('Helvetica-Bold')
    .fillColor('#115E59')
    .text('Delivery Location:', 340, 172);
  doc
    .font('Helvetica')
    .fillColor('#0F172A')
    .text('Chakan Phase II, Pune', 420, 172);
  doc
    .font('Helvetica-Bold')
    .fillColor('#115E59')
    .text('Payment Terms:', 340, 186);
  doc.font('Helvetica').fillColor('#0F172A').text('45 Days Credit', 420, 186);
  doc
    .font('Helvetica-Bold')
    .fillColor('#115E59')
    .text('Project Name:', 340, 200);
  doc
    .font('Helvetica')
    .fillColor('#0F172A')
    .text('Metro Bridge Heavy Shed', 420, 200);

  // Inquiry Note
  doc
    .fontSize(9.5)
    .font('Helvetica')
    .fillColor('#334155')
    .text(
      'Gentlemen,\nWe invite your most competitive item-wise price quotation without fail for the structural steel materials tabulated below for our infrastructure project site.',
      40,
      235,
      { width: 515, lineGap: 3 },
    );

  // Table Header
  const tableTop = 275;
  doc.rect(40, tableTop, 515, 22).fillAndStroke('#134E4A', '#134E4A');
  doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold');
  doc.text('Item #', 45, tableTop + 6, { width: 35, align: 'center' });
  doc.text('Section / Item Description', 85, tableTop + 6, { width: 170 });
  doc.text('Dimensions & Spec', 260, tableTop + 6, { width: 100 });
  doc.text('Standard Length', 365, tableTop + 6, {
    width: 75,
    align: 'center',
  });
  doc.text('Required Qty', 445, tableTop + 6, { width: 55, align: 'right' });
  doc.text('Unit', 505, tableTop + 6, { width: 40, align: 'center' });

  const items = [
    {
      sr: '01',
      desc: 'Heavy Structural Beam (ISMB)',
      dims: 'ISMB 300 (44.2 kg/m)',
      len: '12.0 Meters',
      qty: '35.00',
      unit: 'MT',
    },
    {
      sr: '02',
      desc: 'Heavy Structural Beam (ISMB)',
      dims: 'ISMB 200 (25.4 kg/m)',
      len: '12.0 Meters',
      qty: '25.00',
      unit: 'MT',
    },
    {
      sr: '03',
      desc: 'MS Channel (ISMC)',
      dims: 'ISMC 150 (16.8 kg/m)',
      len: '6.0 Meters',
      qty: '18.50',
      unit: 'MT',
    },
    {
      sr: '04',
      desc: 'MS Equal Angle (ISA)',
      dims: '100 x 100 x 8 MM',
      len: '6.0 Meters',
      qty: '14.00',
      unit: 'MT',
    },
    {
      sr: '05',
      desc: 'Heavy Base Plate (E250)',
      dims: '25MM THK (1500 x 3000)',
      len: 'Standard',
      qty: '20.00',
      unit: 'MT',
    },
  ];

  let currentY = tableTop + 22;
  items.forEach((item, index) => {
    const bg = index % 2 === 0 ? '#FFFFFF' : '#F0FDFA';
    doc.rect(40, currentY, 515, 24).fillAndStroke(bg, '#CCFBF1');
    doc.fillColor('#0F172A').fontSize(8.5).font('Helvetica');
    doc.text(item.sr, 45, currentY + 7, { width: 35, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .text(item.desc, 85, currentY + 7, { width: 170 });
    doc.font('Helvetica').text(item.dims, 260, currentY + 7, { width: 100 });
    doc.text(item.len, 365, currentY + 7, { width: 75, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .text(item.qty, 445, currentY + 7, { width: 55, align: 'right' });
    doc
      .font('Helvetica')
      .text(item.unit, 505, currentY + 7, { width: 40, align: 'center' });
    currentY += 24;
  });

  // Terms & Conditions Block
  currentY += 25;
  doc.rect(40, currentY, 515, 85).stroke('#99F6E4');
  doc.rect(40, currentY, 515, 18).fillAndStroke('#F0FDFA', '#99F6E4');
  doc
    .fillColor('#115E59')
    .fontSize(9)
    .font('Helvetica-Bold')
    .text('COMMERCIAL CONDITIONS:', 48, currentY + 5);

  doc.fillColor('#334155').fontSize(8.5).font('Helvetica');
  doc.text(
    '1. Price basis: Destination site at Chakan Industrial Area, Pune.',
    48,
    currentY + 24,
  );
  doc.text(
    '2. Material standard: BIS Certified Prime IS 2062 Grade E250 A / BR.',
    48,
    currentY + 38,
  );
  doc.text(
    '3. Third Party Inspection (TPI) by Bureau Veritas / TUV allowed before dispatch.',
    48,
    currentY + 52,
  );
  doc.text(
    '4. Payment: 45 Days PDC / LC against accepted weighbridge slip and MTC.',
    48,
    currentY + 66,
  );

  // Sign-off
  currentY += 110;
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .fillColor('#0F172A')
    .text('For RATHI INFRASTRUCTURE PROJECTS LTD.', 40, currentY);
  doc
    .fontSize(8.5)
    .font('Helvetica')
    .fillColor('#64748B')
    .text(
      'Head of Central Procurement | Projects & Infra Division',
      40,
      currentY + 35,
    );
  doc.text(
    'Official Contact: +91 94220 18877 | Direct Email: tenders@rathiinfra.com',
    40,
    currentY + 48,
  );

  doc.end();
}

generatePDF1();
generatePDF2();
console.log('Generated 2 Inquiry PDFs successfully in test_inquiries folder.');

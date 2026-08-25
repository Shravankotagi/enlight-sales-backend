from PIL import Image, ImageDraw, ImageFont
import os

out_dir = r"d:\Enlight sales\test_inquiries"
os.makedirs(out_dir, exist_ok=True)

# Helper function to get default or truetype font
def get_font(size, bold=False):
    try:
        font_name = "arialbd.ttf" if bold else "arial.ttf"
        return ImageFont.truetype(font_name, size)
    except:
        return ImageFont.load_default()

# ---------------- IMAGE 1: APEX STRUCTURAL & STEEL WORKS ----------------
def create_image_1():
    width, height = 1200, 1600
    img = Image.new("RGB", (width, height), color="#FFFFFF")
    draw = ImageDraw.Draw(img)

    # Top Header Background
    draw.rectangle([(40, 40), (1160, 180)], fill="#1E293B")
    draw.text((70, 60), "APEX STRUCTURAL & STEEL WORKS PVT. LTD.", font=get_font(32, True), fill="#FFFFFF")
    draw.text((70, 105), "Works: Plot No. 88, Sector 10, PCMC Industrial Area, Bhosari, Pune - 411026", font=get_font(20), fill="#94A3B8")
    draw.text((70, 135), "GSTIN: 27AABCA7744E1ZQ | Tel: +91 20 2712 9900 | Email: purchase@apexsteelworks.in", font=get_font(19), fill="#94A3B8")

    # Inquiry Title Box
    draw.rectangle([(40, 200), (1160, 260)], fill="#F1F5F9", outline="#CBD5E1", width=2)
    draw.text((70, 218), "MATERIAL INQUIRY & RATE REQUEST", font=get_font(24, True), fill="#0F172A")
    draw.text((850, 220), "Ref: APEX/INQ/AUG-26/104", font=get_font(20, True), fill="#64748B")

    # Inquiry Details Box
    draw.rectangle([(40, 280), (1160, 430)], fill="#FAFAFA", outline="#E2E8F0", width=2)
    draw.text((70, 300), "To Supplier:", font=get_font(20, True), fill="#475569")
    draw.text((70, 330), "Enlight Metals Private Limited", font=get_font(22, True), fill="#0F172A")
    draw.text((70, 360), "Pune, Maharashtra", font=get_font(19), fill="#64748B")
    draw.text((70, 390), "Attn: Sales Operations Team", font=get_font(19), fill="#64748B")

    draw.text((650, 300), "Date:", font=get_font(20, True), fill="#475569")
    draw.text((780, 300), "24th August 2026", font=get_font(20), fill="#0F172A")
    draw.text((650, 335), "Delivery Location:", font=get_font(20, True), fill="#475569")
    draw.text((840, 335), "Bhosari MIDC, Pune", font=get_font(20, True), fill="#0F172A")
    draw.text((650, 370), "Payment Terms:", font=get_font(20, True), fill="#475569")
    draw.text((840, 370), "30 Days Credit", font=get_font(20, True), fill="#0F172A")
    draw.text((650, 400), "Delivery Requirement:", font=get_font(20, True), fill="#475569")
    draw.text((880, 400), "Immediate / 7 Days", font=get_font(20), fill="#0F172A")

    # Intro Message
    draw.text((40, 460), "Dear Sir,", font=get_font(22, True), fill="#1E293B")
    draw.text(
        (40, 495),
        "Kindly share your best commercial quotation (per MT / per Unit) without rate for the following\nprime steel requirements. All materials must be accompanied by Mill Test Certificates (MTC).",
        font=get_font(20),
        fill="#334155"
    )

    # Table Header
    table_y = 570
    draw.rectangle([(40, table_y), (1160, table_y + 50)], fill="#334155")
    draw.text((60, table_y + 12), "#", font=get_font(20, True), fill="#FFFFFF")
    draw.text((120, table_y + 12), "Item Description", font=get_font(20, True), fill="#FFFFFF")
    draw.text((500, table_y + 12), "Specifications / Dimensions", font=get_font(20, True), fill="#FFFFFF")
    draw.text((850, table_y + 12), "Grade / Make", font=get_font(20, True), fill="#FFFFFF")
    draw.text((1030, table_y + 12), "Quantity", font=get_font(20, True), fill="#FFFFFF")

    items = [
        ("1", "MS Sheet (Hot Rolled)", "5MM THK (1250 x 2500 mm)", "IS 2062 E250", "150 Nos"),
        ("2", "MS Sheet (Hot Rolled)", "6MM THK (1250 x 2500 mm)", "IS 2062 E250", "100 Nos"),
        ("3", "HR Coil (Slit Edge)", "3.15MM (1250 mm width)", "JSW / SAIL", "12.0 MT"),
        ("4", "CR Sheet (Cold Rolled)", "1.00MM (1000 x 2000 mm)", "CRCA Grade D", "220 Nos"),
        ("5", "Chequered Plate", "4.00MM THK (1250 x 2500 mm)", "Tear Drop E250", "15.0 MT"),
    ]

    curr_y = table_y + 50
    for idx, (sr, desc, spec, grade, qty) in enumerate(items):
        bg_color = "#FFFFFF" if idx % 2 == 0 else "#F8FAFC"
        draw.rectangle([(40, curr_y), (1160, curr_y + 60)], fill=bg_color, outline="#E2E8F0", width=1)
        draw.text((60, curr_y + 18), sr, font=get_font(20), fill="#64748B")
        draw.text((120, curr_y + 18), desc, font=get_font(20, True), fill="#0F172A")
        draw.text((500, curr_y + 18), spec, font=get_font(20), fill="#334155")
        draw.text((850, curr_y + 18), grade, font=get_font(20), fill="#475569")
        draw.text((1030, curr_y + 18), qty, font=get_font(20, True), fill="#0F172A")
        curr_y += 60

    # Instructions Box
    curr_y += 50
    draw.rectangle([(40, curr_y), (1160, curr_y + 180)], fill="#FFFBEB", outline="#FDE68A", width=2)
    draw.text((70, curr_y + 20), "IMPORTANT INQUIRY GUIDELINES:", font=get_font(20, True), fill="#92400E")
    draw.text((70, curr_y + 60), "1. Rates to be quoted FOR Bhosari MIDC delivery basis including transportation.", font=get_font(18), fill="#78350F")
    draw.text((70, curr_y + 90), "2. Mention standard GST rate (18%) and HSN codes for all items.", font=get_font(18), fill="#78350F")
    draw.text((70, curr_y + 120), "3. Payment: 30 Days Credit against delivery and physical verification.", font=get_font(18), fill="#78350F")
    draw.text((70, curr_y + 150), "4. Please revert with official PDF quotation at purchase@apexsteelworks.in.", font=get_font(18), fill="#78350F")

    # Footer
    curr_y += 240
    draw.text((40, curr_y), "Thanks & Regards,", font=get_font(20), fill="#334155")
    draw.text((40, curr_y + 35), "Mahesh Patil (General Manager - Procurement)", font=get_font(22, True), fill="#0F172A")
    draw.text((40, curr_y + 65), "Apex Structural & Steel Works Pvt. Ltd. | Mobile: +91 98224 55100", font=get_font(19), fill="#64748B")

    img.save(os.path.join(out_dir, "Inquiry_Image_1_Apex_Steel_Works.png"), quality=95)


# ---------------- IMAGE 2: KIRLOSKAR FABRICATION SYSTEMS ----------------
def create_image_2():
    width, height = 1200, 1600
    img = Image.new("RGB", (width, height), color="#FFFFFF")
    draw = ImageDraw.Draw(img)

    # Top Header Background
    draw.rectangle([(40, 40), (1160, 180)], fill="#0D9488")
    draw.text((70, 60), "KIRLOSKAR FABRICATION SYSTEMS LTD.", font=get_font(32, True), fill="#FFFFFF")
    draw.text((70, 105), "Heavy Engineering Div., Gat No. 412, Chakan Industrial Phase 2, Pune - 410501", font=get_font(20), fill="#CCFBF1")
    draw.text((70, 135), "GSTIN: 27AAACK5512B1Z8 | Email: procurements@kirloskarfab.com | Ph: 02135-668800", font=get_font(19), fill="#CCFBF1")

    # Inquiry Title Box
    draw.rectangle([(40, 200), (1160, 260)], fill="#F0FDFA", outline="#99F6E4", width=2)
    draw.text((70, 218), "RATE INQUIRY / TENDER ESTIMATION (WITHOUT PRICE)", font=get_font(24, True), fill="#115E59")
    draw.text((850, 220), "Inquiry No: KFS/2026/092", font=get_font(20, True), fill="#0F766E")

    # Inquiry Details Box
    draw.rectangle([(40, 280), (1160, 430)], fill="#FAFAFA", outline="#E2E8F0", width=2)
    draw.text((70, 300), "Vendor / Supplier:", font=get_font(20, True), fill="#475569")
    draw.text((70, 330), "Enlight Metals Private Limited", font=get_font(22, True), fill="#0F172A")
    draw.text((70, 360), "Pune Industrial Hub", font=get_font(19), fill="#64748B")
    draw.text((70, 390), "Email: sales@enlightmetals.com", font=get_font(19), fill="#64748B")

    draw.text((650, 300), "Inquiry Date:", font=get_font(20, True), fill="#475569")
    draw.text((820, 300), "24-Aug-2026", font=get_font(20), fill="#0F172A")
    draw.text((650, 335), "Destination Site:", font=get_font(20, True), fill="#475569")
    draw.text((820, 335), "Chakan Phase 2, Pune", font=get_font(20, True), fill="#0F172A")
    draw.text((650, 370), "Payment Terms:", font=get_font(20, True), fill="#475569")
    draw.text((820, 370), "100% Advance against PI", font=get_font(20, True), fill="#0F172A")
    draw.text((650, 400), "Delivery Schedule:", font=get_font(20, True), fill="#475569")
    draw.text((820, 400), "Within 5 Working Days", font=get_font(20), fill="#0F172A")

    # Intro Message
    draw.text((40, 460), "Sir,", font=get_font(22, True), fill="#115E59")
    draw.text(
        (40, 495),
        "We are in urgent requirement of prime heavy plates and structural beams for pressure vessel fabrication.\nPlease submit your lowest unit rates and lead time for the following items:",
        font=get_font(20),
        fill="#334155"
    )

    # Table Header
    table_y = 570
    draw.rectangle([(40, table_y), (1160, table_y + 50)], fill="#134E4A")
    draw.text((60, table_y + 12), "#", font=get_font(20, True), fill="#FFFFFF")
    draw.text((120, table_y + 12), "Material & Profile", font=get_font(20, True), fill="#FFFFFF")
    draw.text((500, table_y + 12), "Size / Specification", font=get_font(20, True), fill="#FFFFFF")
    draw.text((850, table_y + 12), "Standard Length", font=get_font(20, True), fill="#FFFFFF")
    draw.text((1030, table_y + 12), "Quantity", font=get_font(20, True), fill="#FFFFFF")

    items = [
        ("1", "Heavy MS Plate", "16MM THK (2000 x 6000 mm)", "IS 2062 E250 B", "25.0 MT"),
        ("2", "Heavy MS Plate", "20MM THK (2000 x 6000 mm)", "IS 2062 E250 B", "20.0 MT"),
        ("3", "Heavy MS Plate", "12MM THK (1500 x 6000 mm)", "IS 2062 E250", "15.0 MT"),
        ("4", "MS Channel (ISMC)", "ISMC 200 (22.3 kg/m)", "6.0 Meters", "18.5 MT"),
        ("5", "Structural Beam (ISMB)", "ISMB 250 (37.3 kg/m)", "12.0 Meters", "30.0 MT"),
    ]

    curr_y = table_y + 50
    for idx, (sr, desc, spec, grade, qty) in enumerate(items):
        bg_color = "#FFFFFF" if idx % 2 == 0 else "#F0FDFA"
        draw.rectangle([(40, curr_y), (1160, curr_y + 60)], fill=bg_color, outline="#CCFBF1", width=1)
        draw.text((60, curr_y + 18), sr, font=get_font(20), fill="#64748B")
        draw.text((120, curr_y + 18), desc, font=get_font(20, True), fill="#0F172A")
        draw.text((500, curr_y + 18), spec, font=get_font(20), fill="#334155")
        draw.text((850, curr_y + 18), grade, font=get_font(20), fill="#475569")
        draw.text((1030, curr_y + 18), qty, font=get_font(20, True), fill="#0F172A")
        curr_y += 60

    # Instructions Box
    curr_y += 50
    draw.rectangle([(40, curr_y), (1160, curr_y + 170)], fill="#F8FAFC", outline="#CBD5E1", width=2)
    draw.text((70, curr_y + 20), "COMMERCIAL TERMS & NOTES:", font=get_font(20, True), fill="#1E293B")
    draw.text((70, curr_y + 55), "- Rates must include loading at yard and transit insurance.", font=get_font(18), fill="#475569")
    draw.text((70, curr_y + 85), "- Material to be supplied strictly with Test Certificates (Chemical + Mechanical).", font=get_font(18), fill="#475569")
    draw.text((70, curr_y + 115), "- Payment: 100% RTGS Advance upon receipt of Proforma Invoice.", font=get_font(18), fill="#475569")
    draw.text((70, curr_y + 145), "- Send quotation to: procurements@kirloskarfab.com", font=get_font(18), fill="#475569")

    # Footer
    curr_y += 230
    draw.text((40, curr_y), "Yours faithfully,", font=get_font(20), fill="#334155")
    draw.text((40, curr_y + 35), "Sunil Deshmukh (Head - Materials & Sourcing)", font=get_font(22, True), fill="#0F172A")
    draw.text((40, curr_y + 65), "Kirloskar Fabrication Systems Ltd. | Direct: +91 98230 77112", font=get_font(19), fill="#64748B")

    img.save(os.path.join(out_dir, "Inquiry_Image_2_Kirloskar_Fabrication.png"), quality=95)


# ---------------- IMAGE 3: WHATSAPP CHAT INQUIRY SCREENSHOT ----------------
def create_image_3():
    width, height = 1000, 1400
    img = Image.new("RGB", (width, height), color="#ECE5DD")
    draw = ImageDraw.Draw(img)

    # WhatsApp Header Bar
    draw.rectangle([(0, 0), (width, 130)], fill="#075E54")
    # Back arrow + DP
    draw.ellipse([(60, 45), (120, 105)], fill="#128C7E", outline="#FFFFFF", width=2)
    draw.text((75, 55), "MS", font=get_font(24, True), fill="#FFFFFF")
    draw.text((140, 45), "Mahalaxmi Steel Industries", font=get_font(24, True), fill="#FFFFFF")
    draw.text((140, 80), "+91 98223 99881 • Online", font=get_font(16), fill="#D1E8E2")

    # Chat Date Pill
    draw.rectangle([(380, 160), (620, 195)], fill="#E1F3FB", outline="#BEE3F8", width=1)
    draw.text((440, 168), "TODAY, 11:45 AM", font=get_font(14, True), fill="#2B6CB0")

    # Received Chat Message Bubble (Customer)
    draw.rectangle([(40, 220), (880, 720)], fill="#FFFFFF", outline="#E2E8F0", width=1)
    
    msg_y = 245
    draw.text((70, msg_y), "Respected Enlight Metals Team,", font=get_font(20, True), fill="#075E54")
    msg_y += 35
    draw.text((70, msg_y), "Please send your lowest quotation for our factory requirement:", font=get_font(18), fill="#1E293B")
    
    msg_y += 40
    draw.text((70, msg_y), "1) MS Sheet 5MM THK (1250 x 2500) - Qty: 150 Nos", font=get_font(18, True), fill="#1E293B")
    msg_y += 32
    draw.text((70, msg_y), "2) MS Sheet 6MM THK (1250 x 2500) - Qty: 100 Nos", font=get_font(18, True), fill="#1E293B")
    msg_y += 32
    draw.text((70, msg_y), "3) HR Coil 3.15MM (1250 mm width) - Qty: 12 MT", font=get_font(18, True), fill="#1E293B")
    msg_y += 32
    draw.text((70, msg_y), "4) CR Sheet 1.00MM (1000 x 2000) - Qty: 220 Nos", font=get_font(18, True), fill="#1E293B")
    msg_y += 32
    draw.text((70, msg_y), "5) MS Chequered Plate 4.5MM - Qty: 8.5 MT", font=get_font(18, True), fill="#1E293B")

    msg_y += 45
    draw.text((70, msg_y), "• Preferred Make: SAIL / JSW / TATA", font=get_font(17), fill="#475569")
    msg_y += 28
    draw.text((70, msg_y), "• Delivery Location: Waluj MIDC Industrial Area, Aurangabad", font=get_font(17, True), fill="#0F172A")
    msg_y += 28
    draw.text((70, msg_y), "• Payment Terms: 30 Days Credit", font=get_font(17, True), fill="#0F172A")
    msg_y += 28
    draw.text((70, msg_y), "• Delivery: Required within 10 days of confirmation", font=get_font(17), fill="#475569")

    msg_y += 45
    draw.text((70, msg_y), "Kindly email official PI to: sales@mahalaxmisteel.com", font=get_font(17, True), fill="#075E54")
    
    # Message timestamp
    draw.text((800, 685), "11:47 AM ✓✓", font=get_font(13), fill="#64748B")

    # Sent Reply Bubble (Enlight Sales)
    draw.rectangle([(250, 750), (960, 870)], fill="#DCF8C6", outline="#C7E5B3", width=1)
    draw.text((280, 770), "Hello Sir, thank you for contacting Enlight Metals!", font=get_font(18, True), fill="#075E54")
    draw.text((280, 805), "We have received your requirement. Calculating best rates", font=get_font(17), fill="#1E293B")
    draw.text((280, 830), "and sharing our official Quotation PDF shortly.", font=get_font(17), fill="#1E293B")
    draw.text((880, 840), "11:49 AM ✓✓", font=get_font(13), fill="#64748B")

    img.save(os.path.join(out_dir, "Inquiry_Image_3_WhatsApp_Chat.png"), quality=95)

create_image_1()
create_image_2()
create_image_3()
print("Generated 3 Inquiry Images successfully in test_inquiries folder.")

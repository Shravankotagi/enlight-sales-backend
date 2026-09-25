# Comprehensive Testing Guide: Visits Extended Fields & Attachments

This testing guide provides an end-to-end, holistic test protocol for validating all extended fields, GPS geotagged photo capture, document attachments, Customer 360 integrations, and AI chatbot conversational flows across the **Customer Site Visits** domain in Enlight Metals OS.

---

## 1. Scope & System Architecture

### 1.1 New Fields Under Test

| Field Name | Database Column | Data Type / Enum Values | UI Component | Chatbot Support |
| :--- | :--- | :--- | :--- | :--- |
| **Email ID** | `email` | `VARCHAR(255)` | Contact Card, Form, Table, 360 POC | Extracted & Updatable |
| **Designation** | `designation` | `VARCHAR(150)` | Contact Card, Form, Table, 360 POC | Extracted & Updatable |
| **City / Location** | `customer_address` | `TEXT` | Core Field, Form, Table | Core Required |
| **Customer Type** | `customer_type` | `OEM`, `Fabricator`, `EPC`, `Manufacturer`, `Trader` | Filter, Table Badge, Form Dropdown | Extracted & Updatable |
| **Visit Type** | `visit_type` | `First Visit`, `Follow-up 1`, `Follow-up 2`, `Follow-up 3`, `Regular Visit` | Filter, Table Badge, Form Dropdown | Extracted & Updatable |
| **Visit Outcome** | `outcome` | `positive`, `neutral`, `negative` | Core Filter, Table Badge, Form Pill | Core Required |
| **Customer Probability**| `customer_probability` | `Hot`, `Warm`, `Cold` | Filter, Table Pill, Form Pill | Extracted & Filterable |
| **Product Details** | `product_details` | `TEXT` | Form Textarea, Details Card | Extracted & Updatable |
| **Monthly Consumption**| `monthly_consumption` | `VARCHAR(100)` | Form Input, Table, Details Card | Extracted & Updatable |
| **Current Requirement**| `current_requirement` | `TEXT` | Form Textarea, Details Card | Extracted & Updatable |
| **Next Purchase Expected**| `next_purchase_expected`| `DATE` | Date Picker, Details Card | Extracted & Updatable |
| **Delivery Location** | `delivery_location` | `VARCHAR(255)` | Form Input, Details Card | Extracted & Updatable |
| **Preferred Brand/Make**| `preferred_make` | `VARCHAR(150)` | Form Input, Details Card | Extracted & Updatable |
| **Payment Terms** | `payment_terms` | `VARCHAR(150)` | Form Input, Details Card | Extracted & Updatable |
| **Geotagged Photo** | `gps_photo_url`, `gps_latitude`, `gps_longitude`, `gps_accuracy` | `TEXT`, `NUMERIC` | Camera Capture, Coordinates, Maps Link | Read in projection |
| **Other Attachments** | `attachments` | `JSONB` array of files | File Upload, Chip preview, Download links | Read in projection |

### 1.2 Core Invariants
- **Strict Zero Emojis:** All UI badges, probability pills (`Hot`, `Warm`, `Cold`), modal headers, table chips, and chatbot card replies MUST use clean B2B typography and Tailwind CSS color styles with zero emoji characters.
- **Zero Workflow Disruption:** All 14 new fields and attachments are **100% optional**. The quick-logging workflow requiring only the core 6 fields must execute without friction or mandatory form validation hurdles.

---

## 2. Test Environment Setup

### 2.1 Starting Local Services

Ensure all three subsystems are running locally:

```bash
# Terminal 1: Backend API (Port 3000)
cd "em-os-backend"
npm run dev

# Terminal 2: Bot Engine (Port 3001)
cd "em-os-bot"
npm run dev

# Terminal 3: Frontend Web App (Port 5173)
cd "em-os-frontend"
npm run dev
```

> [!NOTE]
> If `em-os-bot` throws `sh: .../node_modules/.bin/nodemon: Permission denied`, run:
> ```bash
> chmod +x "em-os-bot/node_modules/.bin/"*
> ```

### 2.2 Access URLs
- **Customer Visits Dashboard:** `http://localhost:5173/visits`
- **Customer 360 Page:** `http://localhost:5173/customers`
- **AI-Assistant Chat:** `http://localhost:5173/assistant`

---

## 3. Test Suite A: Frontend UI Testing (`/visits`)

### Test Case UI-01: Quick-Log Visit (Minimal Core Fields - Zero Disruption)
- **Objective:** Verify that a salesperson can quickly record a visit using only the core 6 fields without filling any extended fields.
- **Steps:**
  1. Navigate to `/visits` and click **+ Add New Visit**.
  2. Select or enter:
     - Customer: `Apex Engineering`
     - Person Met: `Suresh Mehta`
     - Contact Phone: `9820011223`
     - Location: `Bhosari, Pune`
     - Outcome: `Positive`
     - Remarks: `Discussed routine replenishment order for next quarter.`
  3. Leave all optional extended fields, photo, and attachments blank.
  4. Click **Save Visit Record**.
- **Expected Results:**
  - Form submits immediately without validation errors on optional fields.
  - Toast notification confirms successful creation.
  - New row appears at top of table with default visit type `First Visit` and empty optional cells (`-`).
  - No emojis appear anywhere in the row or toast.

---

### Test Case UI-02: Full-Log Visit (All 14 Extended Fields Populated)
- **Objective:** Verify successful creation of a visit with all extended commercial, classification, and stakeholder fields.
- **Steps:**
  1. Click **+ Add New Visit**.
  2. Enter:
     - Customer: `Apex Engineering`
     - Person Met: `Deepak Gupta`
     - Designation: `VP Procurement`
     - Contact Phone: `9820099887`
     - Email: `deepak@apexeng.com`
     - Location: `Chakan MIDC, Pune`
     - Customer Type: `OEM`
     - Visit Type: `First Visit`
     - Outcome: `Positive`
     - Customer Probability: `Hot`
     - Product Details: `SS 304 HR Plates, 10mm to 25mm thickness`
     - Monthly Consumption: `85 MT`
     - Current Requirement: `20 MT SS 304 Plates for immediate delivery`
     - Next Purchase Expected: Select a date 2 weeks ahead (e.g. `2026-10-10`)
     - Delivery Location: `Chakan Plant 3, Gate 2`
     - Preferred Make / Brand: `Jindal Stainless`
     - Payment Terms: `30 Days Credit`
     - Remarks: `Met senior procurement leadership. Technical specs approved.`
  3. Click **Save Visit Record**.
- **Expected Results:**
  - Row appears in table showing:
    - Customer Type pill: `OEM` (slate/indigo styling).
    - Probability pill: `Hot` (rose styling with clean text, no fire emoji).
    - Designation: `VP Procurement`.
    - Email: `deepak@apexeng.com`.
    - Monthly Consumption: `85 MT`.
  - Database stores all fields in `customer_visits`.

---

### Test Case UI-03: Geotagged Camera Photo Capture
- **Objective:** Verify mobile/web GPS capture alongside photo attachment.
- **Steps:**
  1. In the **Add New Visit** modal, locate **Customer Visit Photo (GPS Tagged)**.
  2. Click **Capture Geotagged Photo** (allow browser location permission when prompted).
  3. Upload an image file (e.g., JPEG/PNG of site or entrance).
- **Expected Results:**
  - Image preview displays cleanly.
  - Coordinates badge displays: `GPS: <Latitude>, <Longitude> (±<Accuracy>m)`.
  - Save the visit.
  - In table row, verify camera icon appears indicating photo attached.
  - Click row to open **View Details Modal**:
    - Photo thumbnail is visible.
    - Coordinates are displayed.
    - Click **Open in Google Maps** link -> Google Maps opens in new browser tab pointing to the exact coordinates (`https://www.google.com/maps?q=lat,lng`).

---

### Test Case UI-04: Document Attachments
- **Objective:** Verify multi-document upload, removal, and persistence.
- **Steps:**
  1. In **Add New Visit**, scroll to **Other Attachments**.
  2. Click **Upload Documents** and select 2 files (e.g., `spec_sheet.pdf`, `po_terms.png`).
  3. Verify 2 file chips appear showing file names and size.
  4. Click the `x` button on the second file chip to remove it.
  5. Verify only 1 file chip remains.
  6. Save the visit.
- **Expected Results:**
  - Table row displays attachment count badge (e.g. `1 file`).
  - Open **View Details Modal**: the document appears with a download/external link icon.
  - Clicking the document opens or downloads the file.

---

### Test Case UI-05: Customer Directory Selection & Auto-Fill
- **Objective:** Verify selecting an existing customer automatically populates known profile information into the visit form.
- **Steps:**
  1. Open **+ Add New Visit**.
  2. In the **Customer Name** combobox, type and select a known customer (e.g. `Apex Engineering`).
- **Expected Results:**
  - Address / Location auto-populates if previously stored.
  - Contact Person and Phone number auto-fill.
  - Email, Designation, and Customer Type auto-fill if previously known.
  - User can override any auto-filled value before saving.

---

### Test Case UI-06: Filter Bar Testing
- **Objective:** Test filtering the visits list by Customer Type, Probability, and Visit Type.
- **Steps & Matrix:**
  1. **Customer Type Filter:** Select `OEM` -> Table must only display rows where Customer Type is `OEM`.
  2. **Customer Type Filter:** Select `Fabricator` -> Table filters to fabricators.
  3. **Probability Filter:** Select `Hot` -> Table displays only `Hot` visits. Verify count badge matches visible rows.
  4. **Probability Filter:** Select `Cold` -> Table displays only `Cold` visits.
  5. **Visit Type Filter:** Select `First Visit` -> Table displays only first visits.
  6. **Combined Filters:** Select `OEM` + `Hot` -> Table displays only hot OEM accounts.
  7. **Clear Filters:** Click **Clear Filters** -> All dropdowns reset to `All` and full visit list re-renders.
- **Expected Results:**
  - Filtering operates instantly in memory and through API reload without crashing.
  - Empty state displays `"No customer visits match the current filter criteria"` when zero matches exist.

---

### Test Case UI-07: View Details & Edit Modal
- **Objective:** Test comprehensive view layout and editing of all extended fields.
- **Steps:**
  1. Click on the visit created in **UI-02** to open the details modal.
  2. Verify 2-column layout:
     - Left column: Company info, Contact card (Person Met, Phone, Email, Designation), Classification card (Type, Visit Type, Probability, Outcome).
     - Right column: Commercial details (Monthly consumption, current requirement, product specs, delivery location, preferred brand, payment terms), Geotag photo card, Attachments list.
  3. Click **Edit Visit** button.
  4. Modify fields:
     - Change Designation: `Director of Operations`
     - Change Customer Probability: from `Hot` to `Warm`
     - Change Payment Terms: from `30 Days Credit` to `45 Days PDC`
     - Change Monthly Consumption: from `85 MT` to `110 MT`
  5. Click **Update Visit Record**.
- **Expected Results:**
  - Modal saves and switches back to read-only view.
  - Updated fields reflect immediately on screen.
  - Table row updates without needing a hard page refresh.

---

### Test Case UI-08: Zero-Emoji Visual Audit
- **Objective:** Ensure no emojis exist in the UI presentation.
- **Steps:**
  1. Inspect Probability pill colors:
     - `Hot`: Rose background (`bg-rose-50`), rose text (`text-rose-700`), rose dot or clean label. No flame emoji (`🔥`).
     - `Warm`: Amber background (`bg-amber-50`), amber text (`text-amber-700`). No sun emoji (`☀️`).
     - `Cold`: Sky background (`bg-sky-50`), sky text (`text-sky-700`). No snowflake emoji (`❄️`).
  2. Inspect Filter dropdown options: All options are plain English text.
  3. Inspect modal headers, button labels, and table action buttons: Zero emojis.

---

## 4. Test Suite B: Customer 360 Page Testing (`/customers`)

### Test Case C360-01: Stakeholder Directory Integration
- **Objective:** Verify that POCs and designations logged via visits surface in Customer 360.
- **Steps:**
  1. Navigate to `/customers` and select `Apex Engineering`.
  2. Open the **Stakeholders / Key Contacts** section.
- **Expected Results:**
  - `Deepak Gupta` appears with role/designation `Director of Operations` (or `VP Procurement`).
  - Contact email `deepak@apexeng.com` is displayed with clickable mailto link.
  - Phone number is displayed with call link.

### Test Case C360-02: Visits History Tab in Customer 360
- **Objective:** Verify extended visit history within customer profile.
- **Steps:**
  1. Scroll down to the **Site Visits & Field Meetings** table on the customer page.
- **Expected Results:**
  - All logged visits appear chronologically.
  - Table columns display: Date, Person Met, Designation, Customer Type pill, Probability pill, Outcome, Monthly Consumption, and Remarks.
  - Zero emojis present in badges or cards.

---

## 5. Test Suite C: Chatbot Web Assistant & WhatsApp Testing (`/assistant`)

### Test Case BOT-01: Quick Natural Language Visit (No Extended Fields)
- **Objective:** Verify bot logs a visit using natural informal Hinglish without asking for optional extended fields.
- **Prompt:**
  ```text
  Kal Om Fabricators gaya tha, met Ramesh in Chakan Pune, phone 9822012345. Meeting positive thi, discussed HR sheet requirement.
  ```
- **Expected Results:**
  - Bot recognizes `LOG_VISIT` intent.
  - Visit is saved directly without blocking or prompting for Email, Customer Type, or Probability.
  - Bot reply displays confirmation using hyphen bullets (`- `) and zero emojis:
    ```text
    Customer Visit Logged

    Customer: Om Fabricators
    - Visit Date: 23 Sep 2026
    - Location: Chakan Pune
    - Person Met: Ramesh
    - Contact Phone: 9822012345
    - Outcome: Positive
    - Discussion Notes: discussed HR sheet requirement

    Total Visits This Month: ...

    Updated Customer Visits Card!
    ```

---

### Test Case BOT-02: Comprehensive Natural Language Visit (With Extended Fields)
- **Objective:** Verify bot extracts all extended fields from a rich conversational report.
- **Prompt:**
  ```text
  Logged a visit today with Precision Steels in Navi Mumbai. Met VP Purchase Arvind Nair, email arvind@precisionsteels.com, phone 9811223344. They are an OEM manufacturer, this is our First Visit. Probability is Hot. Monthly consumption is 150 MT HR Coils. Current requirement is 40 MT 3.0mm HR Sheets, expected next purchase by 15th October. Preferred make is JSW Steel, payment terms 30 days credit, delivery at Turbhe warehouse. Discussion was very positive.
  ```
- **Expected Results:**
  - Bot extracts:
    - `customer_name`: `Precision Steels`
    - `person_met`: `Arvind Nair`
    - `designation`: `VP Purchase`
    - `email`: `arvind@precisionsteels.com`
    - `contact_no`: `9811223344`
    - `city`: `Navi Mumbai`
    - `customer_type`: `OEM`
    - `visit_type`: `First Visit`
    - `customer_probability`: `Hot`
    - `monthly_consumption`: `150 MT`
    - `current_requirement`: `40 MT 3.0mm HR Sheets`
    - `next_purchase_expected`: `2026-10-15` (or text)
    - `preferred_make`: `JSW Steel`
    - `payment_terms`: `30 days credit`
    - `delivery_location`: `Turbhe warehouse`
    - `visit_outcome`: `positive`
  - Record is inserted in `customer_visits` with all columns populated.
  - Bot confirms with clean hyphen bullets and no emojis.

---

### Test Case BOT-03: Natural Language Visit Correction / Update
- **Objective:** Verify salesperson can update extended fields conversationally.
- **Prompt:**
  ```text
  Update visit for Precision Steels, change customer probability to Warm and payment terms to 45 days PDC
  ```
- **Expected Results:**
  - Bot resolves the target visit record for `Precision Steels`.
  - Identifies target fields and applies update in PostgreSQL:
    - `customer_probability` becomes `Warm`.
    - `payment_terms` becomes `45 days PDC`.
  - Bot responds:
    ```text
    Customer Visit Updated

    Customer: Precision Steels
    - Visit Date: ...
    - Updated Customer Probability: Warm (was Hot)
    - Updated Payment Terms: 45 days PDC (was 30 days credit)

    Updated Customer Visits Card!
    ```

---

### Test Case BOT-04: Bot Catalog Flow Menu Execution
- **Objective:** Test structured form flow in bot.
- **Steps:**
  1. In `/assistant`, type: `log visit`
  2. Bot responds with:
     ```text
     **Log Customer Field Visit**

     Please provide the following details:
     - Customer / Company: *
     - Person Met: *
     - Contact Phone: *
     - City / Location: *
     - Visit Date: *
     - Visit Outcome: * (Positive / Negative / Neutral / Follow-up Required)
     - Follow-up Action: (optional)
     - Meeting Remarks: *

     Optional Extended Fields:
     - Email, Designation, Customer Type (OEM / Fabricator / EPC / Manufacturer / Trader)
     - Visit Type (First Visit / Follow-up 1-3 / Regular Visit), Probability (Hot / Warm / Cold)
     - Product Details, Monthly Consumption, Current Requirement, Preferred Make, Payment Terms, Delivery Location
     ```
  3. Provide all details in response.
  4. Confirm preview when prompted.
- **Expected Results:**
  - Summary preview cleanly enumerates provided fields.
  - Final confirmation says: `Customer Field Visit Logged Successfully!` with no emojis.

---

### Test Case BOT-05: Querying Visits by Extended Criteria
- **Objective:** Test bot search and retrieval filters.
- **Prompt 1:** `"Show all Hot visits logged this month"`
- **Expected:** Bot calls `get_visits` with `customer_probability: "Hot"` and lists matching records.
- **Prompt 2:** `"Show me visits to OEM customers"`
- **Expected:** Bot calls `get_visits` with `customer_type: "OEM"` and lists matching records.

---

## 6. Test Suite D: Direct Backend API Validation (`curl`)

Run these tests from your terminal to verify HTTP status codes and JSON payloads:

### Test Case API-01: Create Visit with Full Extended Payload
```bash
curl -X POST http://localhost:3000/kra/visits \
  -H "Content-Type: application/json" \
  -d '{
    "salesperson_phone": "919820011223",
    "customer_name": "API Test Manufacturing Corp",
    "person_met": "Anil Deshmukh",
    "designation": "Plant GM",
    "email": "anil@apitest.com",
    "contact_no": "9820011223",
    "customer_address": "Pimpri, Pune",
    "outcome": "positive",
    "customer_type": "Manufacturer",
    "visit_type": "First Visit",
    "customer_probability": "Hot",
    "product_details": "GI Coils 0.8mm",
    "monthly_consumption": "50 MT",
    "current_requirement": "15 MT GI Coils",
    "next_purchase_expected": "2026-10-20",
    "delivery_location": "Pimpri Gate 1",
    "preferred_make": "AM/NS",
    "payment_terms": "Advance against PI",
    "remarks": "API verification visit creation test",
    "gps_latitude": 18.6279,
    "gps_longitude": 73.8009,
    "gps_accuracy": 8.4,
    "attachments": [
      { "name": "sample_quote.pdf", "url": "https://example.com/quote.pdf", "size": 2048 }
    ]
  }'
```
- **Expected Result:** HTTP `201 Created` with JSON object containing generated `id` and all 18 fields.

### Test Case API-02: Partial Patch Update
```bash
curl -X PATCH http://localhost:3000/kra/visits/<REPLACE_WITH_ID> \
  -H "Content-Type: application/json" \
  -d '{
    "customer_probability": "Warm",
    "payment_terms": "30 Days Credit"
  }'
```
- **Expected Result:** HTTP `200 OK` returning updated visit record with `customer_probability: "Warm"`.

---

## 7. Verification Checklist & Sign-off Table

| Test ID | Test Description | Interface | Status (Pass/Fail) | Verified By |
| :--- | :--- | :--- | :--- | :--- |
| **UI-01** | Quick-Log Visit (Minimal Core Fields) | Web (`/visits`) | [ ] | |
| **UI-02** | Full-Log Visit (All 14 Extended Fields) | Web (`/visits`) | [ ] | |
| **UI-03** | GPS Photo Capture & Google Maps Link | Web (`/visits`) | [ ] | |
| **UI-04** | Document Upload, Chip Delete, Download | Web (`/visits`) | [ ] | |
| **UI-05** | Directory Selection & Auto-fill | Web (`/visits`) | [ ] | |
| **UI-06** | Filter Bar (Type, Probability, Visit Type) | Web (`/visits`) | [ ] | |
| **UI-07** | View Details & Edit Modal Layout | Web (`/visits`) | [ ] | |
| **UI-08** | Zero-Emoji Audit (No emojis in pills/badges) | Web UI | [ ] | |
| **C360-01**| Stakeholder Email & Role in Customer 360 | Web (`/customers`)| [ ] | |
| **C360-02**| Visits History Table in Customer 360 | Web (`/customers`)| [ ] | |
| **BOT-01** | Bot Quick-Log (Zero Gating) | `/assistant` | [ ] | |
| **BOT-02** | Bot Natural Language Rich Extraction | `/assistant` | [ ] | |
| **BOT-03** | Bot Natural Language Visit Correction | `/assistant` | [ ] | |
| **BOT-04** | Bot Catalog Flow Structured Form | `/assistant` | [ ] | |
| **BOT-05** | Bot Retrieval by Probability & Customer Type | `/assistant` | [ ] | |
| **BOT-06** | Bot Zero-Emoji Reply Verification | `/assistant` | [ ] | |
| **API-01** | REST API POST Full Payload | cURL / Postman | [ ] | |
| **API-02** | REST API PATCH Partial Fields | cURL / Postman | [ ] | |

---

## 8. Defect Reporting Guide

If any step fails, document the issue with:
1. **Test ID** (e.g. `UI-03` or `BOT-02`).
2. **Input / Prompt Used**.
3. **Observed Behavior** (screenshot or terminal output).
4. **Expected Behavior**.
5. **Console / Network Logs** (`F12` Developer Tools -> Console / Network tab).

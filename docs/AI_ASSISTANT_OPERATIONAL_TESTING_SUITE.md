# Enlight Metals Sales OS - AI Assistant Operational Add-ons Testing Suite & Manual Verification Guide

This document is the comprehensive manual testing playbook for all new transactional and operational capabilities added to the Enlight Metals Sales OS Conversational AI Assistant. It enables developers, QA testers, and sales leads to manually test and verify 100% operational parity between the web AI Assistant and the WhatsApp Bot (`em-os-bot`).

---

## 1. Test Setup & Persona Profiles

To properly verify Role-Based Access Control (RBAC), data isolation, and multi-turn state machines, execute tests using authenticated sessions corresponding to the following identities:

| Persona Name       | Role            | Phone Number   | Employee ID | Assigned Accounts                                            | Scope & Testing Purpose                                                                                                |
| :----------------- | :-------------- | :------------- | :---------- | :----------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| **Rishabh**        | `salesperson`   | `919619226169` | `EMP009`    | `Supreme Steel Pvt Ltd`, `Dynamic Industries`, `Pooja Steel` | Primary sales rep. Tests all 9 operational write tools, active sessions, and verify denial of access to peer accounts. |
| **Max**            | `salesperson`   | `918262937458` | `EMP0004`   | `Supreme Steel`, `Mehta Tubes`                               | Secondary sales rep. Tests bidirectional cross-salesperson isolation on operational actions.                           |
| **John**           | `sales_manager` | `917878787878` | `EMP007`    | Team accounts (Rishabh, Max, Akruti)                         | Manager-level pipeline oversight, team reassignments, and aggregate operational reviews.                               |
| **Dhananjay Goel** | `admin`         | `919187305823` | `EMP000`    | All accounts across Enlight Metals                           | Global unrestricted visibility, cross-team approvals, and system-wide loss analytics.                                  |

---

## 2. Global Presentation & Quality Standards

Every valid response from the AI Assistant must strictly adhere to the following mandates:

1. **Zero Emojis Policy (Mandatory)**:
   - The assistant must **NEVER** output any emojis in any turn or confirmation.
   - All legacy bot emojis (e.g., checkmarks, trucks, phones, cars, exclamation marks) are stripped automatically.
2. **Clean Markdown Bullet Lists**:
   - Bullet points must strictly start with hyphen bullets (`- Item`) or numbers (`1. Item`).
   - Bullet lines must **NEVER** start with asterisks (`* Item`).
   - Bold text must be cleanly closed (`**Text**` or `*Text*`).
3. **Strict Human-Readable Inquiry ID Format**:
   - Every inquiry or deal code must strictly follow the `#INQ-XXXXXX` format (e.g., `#INQ-950E9A`).
   - Database UUIDs (36 characters) must **NEVER** be displayed to the user.
4. **Official Card Naming Conventions**:
   - Business modules must always be referenced by their official card names:
     - _Inquiries & WhatsApp Leads_
     - _New Customer Acquisition (KRA 2)_
     - _Customer Retention & Reorders (KRA 3)_
     - _Lost Deals & Loss Analytics (KRA 4)_
     - _Payment Collection (KRA 5)_
     - _Customer Complaints & Quality Issues (KRA 7 & 8)_
     - _Customer Site Visits (KRA 9)_
     - _Deals & Orders Pipeline_
     - _Customer 360 & Directory_
5. **Direct Forwarding of Interactive Prompts**:
   - Disambiguation choices, stage gate warnings, and confirmation options must be forwarded directly without LLM summarization to prevent dropping options or buttons.

---

## 3. Operational Write Tools Manual Test Cases

---

### Test Case 1.1: Create New Customer Inquiry (`update_deal_stage`)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Action**: Creating a multi-item customer inquiry with dimensions and target rates.
- **Input Prompt**:
  ```text
  Create inquiry for Supreme Steel Pvt Ltd: 20 MT HR Coil 2.5mm and 10 MT CR Sheet 1.2mm
  ```
- **Expected Tool Executed**: `update_deal_stage` with `{ "text": "..." }`
- **Expected Response & Assertions**:
  - Contains title: `Inquiry Created` or `Inquiry Updated - #INQ-XXXXXX`.
  - Customer name recognized: `Supreme Steel Pvt Ltd`.
  - Item 1: `HR Coil 2.5mm` | 20 MT @ ₹52,000/MT = ₹10,40,000.
  - Item 2: `CR Sheet 1.2mm` | 10 MT @ ₹58,000/MT = ₹5,80,000.
  - Financial Breakdown:
    - Subtotal: ₹16,20,000
    - GST (18%): ₹2,91,600
    - Grand Total: ₹19,11,600
  - Zero emojis present in the output.
  - Bullet points formatted with `- `.
- **Database Verification**:
  - Table `inquiries`: Record created with status `processed`.
  - Table `deals`: Record created/updated with stage `new_inquiry`, total_amount = ₹16,20,000.
  - Table `deal_items`: 2 line items inserted with quantities, rates, and amounts.

---

### Test Case 1.2: Update Deal Prices / Rates (`update_deal_stage`)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Action**: Updating pricing on an open inquiry without repeating line items.
- **Input Prompt**:
  ```text
  Update rate for Supreme Steel Pvt Ltd HR Coil to 53500
  ```
- **Expected Tool Executed**: `update_deal_stage`
- **Expected Response & Assertions**:
  - Automatically identifies active inquiry `#INQ-XXXXXX` for `Supreme Steel Pvt Ltd`.
  - Displays updated line items with new rate: `20 MT @ ₹53,500/MT = ₹10,70,000`.
  - Subtotal and GST recalculate accurately.
  - Formatted cleanly with hyphen lists and zero emojis.
- **Database Verification**:
  - Table `deal_items`: Target line item rate updated to `53500`.
  - Table `deals`: `total_amount` updated.

---

### Test Case 1.3: Confirm Purchase Order & Mark Deal Won (`update_deal_stage`)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Action**: Marking a deal as won with a confirmed customer PO number.
- **Input Prompt**:
  ```text
  Deal won for Supreme Steel Pvt Ltd PO-2026-9941
  ```
- **Expected Tool Executed**: `update_deal_stage`
- **Expected Response & Assertions**:
  - Response confirms deal won: `DEAL WON & PO CONFIRMED` or `Deal Marked as WON`.
  - Inquiry ID displayed in `#INQ-XXXXXX` format.
  - PO Number displayed: `PO-2026-9941`.
  - Deal Stage: `Won / Order Booked`.
  - Zero emojis.
- **Database Verification**:
  - Table `deals`: `stage` = `won`, `po_number` = `PO-2026-9941`, `won_at` timestamp recorded.

---

### Test Case 1.4: Mark Deal Lost with Loss Reason (`update_deal_stage`)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Action**: Marking an inquiry/deal as lost with immediate reason.
- **Input Prompt**:
  ```text
  Mark deal as lost for Supreme Steel Pvt Ltd due to competitor price
  ```
- **Expected Tool Executed**: `update_deal_stage`
- **Expected Response & Assertions**:
  - Response confirms deal closed lost: `Deal Marked as LOST`.
  - Customer: `Supreme Steel Pvt Ltd`.
  - Stage: `Closed Lost`.
  - Reason: `Price` or `Competitor price`.
  - Mentions update to `Lost Deals & Loss Analytics (KRA 4) Dashboard`.
  - Zero emojis.
- **Database Verification**:
  - Table `deals`: `stage` = `lost`, `lost_reason` = `Price`.
  - Table `kra_logs`: Record inserted with `kra_number` = 4, `kra_type` = `deal_lost`.

---

### Test Case 1.5: Stage Gate Enforcement Advisory (`update_deal_stage`)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Action**: Attempting to mark a brand new inquiry directly as won without generating a quotation first.
- **Input Prompt**:
  ```text
  Create inquiry for Dynamic Industries 10 MT HR Coil and mark it won immediately
  ```
- **Expected Behavior & Assertions**:
  - System enforces commercial SOP stage gate.
  - Displays warning advisory: `Quotation Required First` or `Stage Gate Policy`.
  - Informs the salesperson that the inquiry must be in `quoted` or `sent_to_party` stage before an order can be booked.
  - Exact advisory forwarded cleanly with zero emojis.

---

### Test Case 1.6: Customer Site Visit Logging (`log_customer_visit` - KRA 9)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Action**: Logging a field / site meeting with remarks, requirements, and follow-up.
- **Input Prompt**:
  ```text
  Visited Supreme Steel Pvt Ltd today at their plant, met Mr. Rajesh Sharma, discussed requirement for 25 MT HR Coil 2.5mm, outcome was positive, next step is to send formal quote tomorrow.
  ```
- **Expected Tool Executed**: `log_customer_visit` with `{ "text": "..." }`
- **Expected Response & Assertions**:
  - Title: `Visit Logged!`.
  - Company: `Supreme Steel Pvt Ltd`.
  - Contact Met: `Mr. Rajesh Sharma`.
  - Location: Captures plant location if recorded or customer address.
  - Requirement: `25 MT HR Coil 2.5mm`.
  - Outcome: `Positive`.
  - Next Follow-Up: Automatically sets date to tomorrow (`2026-09-08`).
  - Mentions update to `Customer Site Visits (KRA 9) Dashboard`.
  - Zero emojis.
- **Database Verification**:
  - Table `customer_visits`: Row inserted with `person_met`, `outcome` = `positive`, `follow_up_action`, and `visited_at`.
  - Zoho Bigin CRM sync logs non-blocking note update.

---

### Test Case 1.7: Customer Quality Complaint Logging (`log_complaint` - KRA 7 & 8)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Action**: Recording a customer defect complaint with 48-hour SLA calculation.
- **Input Prompt**:
  ```text
  Supreme Steel Pvt Ltd reported quality complaint: 2 HR coils delivered had severe edge wave defect and rust, urgent inspection needed
  ```
- **Expected Tool Executed**: `log_complaint`
- **Expected Response & Assertions**:
  - Detects matching open order / PO for Supreme Steel Pvt Ltd.
  - If single order found: Confirms complaint logged with ticket reference.
  - If multiple orders found: Returns clean order disambiguation prompt with `#INQ-XXXXXX` and PO numbers.
  - Confirms defect categorization: `Quality / Material Defect (Rust / Edge Wave)`.
  - Explicitly states 48-hour resolution deadline.
  - Zero emojis.
- **Database Verification**:
  - Table `complaints`: Row inserted with `customer_name`, `complaint_type` = `quality`, `status` = `open`, `target_resolution_date` = now + 48 hours.
  - Table `kra_logs`: Logged under KRA 7/8.

---

### Test Case 1.8: Customer Complaint Resolution Logging (`log_complaint`)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Action**: Recording resolution of an existing customer complaint.
- **Input Prompt**:
  ```text
  Complaint for Supreme Steel Pvt Ltd resolved - replacement material delivered and customer satisfied
  ```
- **Expected Tool Executed**: `log_complaint`
- **Expected Response & Assertions**:
  - Confirms complaint resolution: `Complaint Resolved`.
  - Status: `Closed / Resolved`.
  - Resolution notes captured: `Replacement material delivered and customer satisfied`.
  - SLA Status: `Within 48h SLA` (or breached SLA if elapsed).
  - Zero emojis.
- **Database Verification**:
  - Table `complaints`: Status updated to `resolved`, `resolved_at` recorded, `resolution_notes` updated.

---

### Test Case 1.9: Payment Collection Logging (`log_payment` - KRA 5)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Action**: Recording customer payment receipt with mode and transaction reference.
- **Input Prompt**:
  ```text
  Received payment of Rs 150000 from Supreme Steel Pvt Ltd via NEFT reference UTR9988221
  ```
- **Expected Tool Executed**: `log_payment`
- **Expected Response & Assertions**:
  - If customer has an open deal in `quoted` stage: Intercepts and prompts:
    ```text
    Payment Confirmation Required
    Supreme Steel Pvt Ltd currently has an open deal:
    Stage: Quoted
    Deal Value: ₹32,50,000

    Before logging this payment of ₹1,50,000, please confirm:
    1. Yes, log payment - deal will remain at Quoted
    2. Mark deal as Won first - then payment will be logged automatically

    Reply 1 or 2 to proceed.
    ```
  - If customer has a won order: Confirms payment logged:
    - Amount: `₹1,50,000`
    - Mode: `NEFT`
    - Reference: `UTR9988221`
    - Updated: `Payment Collection (KRA 5) Dashboard`
  - Zero emojis.
- **Database Verification**:
  - Table `kra_logs`: Record inserted with `kra_number` = 5, `kra_type` = `payment_collection`, `value` = 150000.

---

### Test Case 1.10: New Customer Onboarding (`onboard_new_customer` - KRA 2)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Action**: Onboarding a new customer account with duplicate checking.
- **Input Prompt**:
  ```text
  Onboard new customer Synergy Fabrication, contact Rajesh Patel 9876543210, GST 27AABCU9603R1ZM, Pune
  ```
- **Expected Tool Executed**: `onboard_new_customer`
- **Expected Response & Assertions**:
  - Confirms new customer onboarding: `New Customer Onboarded!`.
  - Company: `Synergy Fabrication`.
  - Contact Person: `Rajesh Patel`.
  - Phone: `9876543210`.
  - GSTIN: `27AABCU9603R1ZM`.
  - City/Location: `Pune`.
  - Mentions logging to `New Customer Acquisition (KRA 2)`.
  - Zero emojis.
- **Database Verification**:
  - Table `recurring_customers`: Record created with `customer_name` = `Synergy Fabrication`, `customer_phone` = `9876543210`, `customer_gst` = `27AABCU9603R1ZM`, `assigned_salesperson_phone` = `919619226169`.
  - Table `kra_logs`: Logged under KRA 2.

---

### Test Case 1.11: Duplicate Customer Onboarding Prevention (`onboard_new_customer`)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Action**: Attempting to onboard a customer using an already registered phone number or GSTIN.
- **Input Prompt**:
  ```text
  Onboard new customer Synergy Steel, contact Rajesh 9876543210, Pune
  ```
- **Expected Response & Assertions**:
  - Detects that mobile number `9876543210` is already assigned to `Synergy Fabrication`.
  - Politely informs that this customer already exists in the system.
  - Does NOT create a duplicate record in `recurring_customers`.
  - Zero emojis.

---

### Test Case 1.12: Update Customer Profile & Order Frequency (`update_customer_profile`)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Action**: Changing order frequency days and owner details in-place.
- **Input Prompt**:
  ```text
  Change Supreme Steel Pvt Ltd order frequency to 45 days, contact person Vikram Kapoor
  ```
- **Expected Tool Executed**: `update_customer_profile`
- **Expected Response & Assertions**:
  - Confirms profile updated: `Customer Profile Updated!`.
  - Company: `Supreme Steel Pvt Ltd`.
  - Order Frequency: `Every 45 days`.
  - Contact: `Vikram Kapoor`.
  - Zero emojis.
- **Database Verification**:
  - Table `recurring_customers`: `avg_order_frequency_days` and `target_frequency_days` set to 45. `contact_person` updated in-place without creating new customer rows.

---

### Test Case 1.13: Customer Retention Follow-Up Logging (`log_retention_followup` - KRA 3)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Action**: Logging a retention call check-in regarding previous shipments.
- **Input Prompt**:
  ```text
  Called Supreme Steel Pvt Ltd to check on past order satisfaction, owner confirmed they will place reorder next Tuesday
  ```
- **Expected Tool Executed**: `log_retention_followup`
- **Expected Response & Assertions**:
  - Confirms follow-up recorded: `Follow-up Recorded` or `Retention Follow-Up Logged`.
  - Action: `Called`.
  - Customer: `Supreme Steel Pvt Ltd`.
  - Outcome: Captures note regarding reorder next Tuesday.
  - Mentions update to `Customer Retention (KRA 3)`.
  - Zero emojis.
- **Database Verification**:
  - Table `kra_logs`: Logged under KRA 3 with customer name.

---

### Test Case 1.14: Quotation PDF Generation & Email Dispatch (`send_quotation`)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Action**: Explicitly requesting quotation dispatch.
- **Input Prompt**:
  ```text
  Send quotation for Supreme Steel Pvt Ltd to rishabh@enlightmetals.com
  ```
- **Expected Tool Executed**: `send_quotation`
- **Expected Response & Assertions**:
  - Confirms quotation generation: `Quotation Sent` or `Quotation Generated`.
  - Recipient email: `rishabh@enlightmetals.com`.
  - Quotation PDF generated with proper HSN codes (7208/7214) and 18% GST calculation.
  - Zero emojis.

---

### Test Case 1.15: Inquiry ID Lookup (`get_deal_ids`)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Action**: Asking for the active Inquiry ID of a company.
- **Input Prompt**:
  ```text
  What is the inquiry ID for Supreme Steel Pvt Ltd?
  ```
- **Expected Tool Executed**: `get_deal_ids`
- **Expected Response & Assertions**:
  - Returns active inquiry code(s) formatted as `#INQ-XXXXXX`.
  - Shows stage, created date, and line items.
  - Zero emojis.

---

## 4. Active Multi-Turn Flow Interception Test Cases

These test cases verify the state machine in `ChatbotService` that intercepts pending conversational sessions stored in `conversation_sessions.last_intent`.

---

### Test Case 2.1: Multi-Turn Deal Loss Flow (Numeric Option Selection)

1. **Turn 1 (Prompt)**:
   - **Input**:
     ```text
     Mark deal as lost for Supreme Steel Pvt Ltd
     ```
   - **Expected Assistant Output**:
     The assistant detects that no loss reason was provided and returns the numbered loss reason menu:
     ```text
     Please provide the reason for losing this deal:
     1. Price (Competitor cheaper)
     2. Credit terms
     3. Delivery timeline
     4. Material unavailable
     5. Spec mismatch
     6. Competitor relationship
     7. Customer silent
     8. Cancelled by customer
     Or type your specific reason.
     ```
   - **Database State**: `conversation_sessions.last_intent` is set to `pending_loss_reason|<dealId>|Supreme Steel Pvt Ltd`.

2. **Turn 2 (Numeric Selection)**:
   - **Input**:
     ```text
     1
     ```
   - **Expected Assistant Output**:
     The active session intercept intercepts the turn before LLM processing and returns:
     ```text
     Deal Marked as LOST

     - Customer: Supreme Steel Pvt Ltd
     - Stage: Closed Lost
     - Reason: Price

     Updated Lost Deals & Loss Analytics (KRA 4) Dashboard.
     ```
   - **Database State**:
     - `deals`: `stage` = `lost`, `lost_reason` = `Price`.
     - `kra_logs`: Logged under KRA 4.
     - `conversation_sessions.last_intent` reset to `general`.
   - **Formatting**: Zero emojis, hyphen bullets.

---

### Test Case 2.2: Multi-Turn Payment Confirmation Flow (Option 2: Mark Won First)

1. **Turn 1 (Payment on Quoted Deal)**:
   - **Input**:
     ```text
     Received payment of Rs 150000 from Supreme Steel Pvt Ltd
     ```
   - **Expected Assistant Output**:
     Detects open deal in `quoted` stage:
     ```text
     Payment Confirmation Required

     Supreme Steel Pvt Ltd currently has an open deal:
     Stage: Quoted
     Deal Value: ₹32,50,000

     Before logging this payment of ₹1,50,000, please confirm:
     1. Yes, log payment - deal will remain at Quoted
     2. Mark deal as Won first - then payment will be logged automatically

     Reply 1 or 2 to proceed.
     ```
   - **Database State**: `conversation_sessions.last_intent` is set to `pending_payment_confirm|<dealId>|Supreme Steel Pvt Ltd|150000|...`.

2. **Turn 2 (Select Option 2)**:
   - **Input**:
     ```text
     2
     ```
   - **Expected Assistant Output**:
     - Intercepts option 2.
     - Auto-generates PO number (e.g. `PO-20260907-XXXX`).
     - Marks deal as `won`.
     - Logs payment of ₹1,50,000.
     - Returns confirmation:
       ```text
       Deal Marked as WON & Payment Logged!

       Payment Logged!
       Customer: Supreme Steel Pvt Ltd
       Amount Paid: ₹1,50,000
       Remaining Balance: ₹31,00,000
       Status: Partial Payment Recorded
       ```
   - **Database State**:
     - `deals`: `stage` = `won`, `po_number` populated, `won_at` recorded.
     - `kra_logs`: Logged under KRA 5.
     - `conversation_sessions.last_intent` reset to `general`.
   - **Formatting**: Zero emojis.

---

## 5. Conversational Memory & Cross-Turn Continuity Test Cases

---

### Test Case 3.1: Pronoun & Active Customer Memory Resolution

1. **Turn 1**:
   - **Input**:
     ```text
     Create inquiry for Pooja Steel: 15 MT HR Coil 2mm
     ```
   - **Expected Output**: Inquiry `#INQ-XXXXXX` created for `Pooja Steel`.
2. **Turn 2**:
   - **Input**:
     ```text
     Update rate to 52500
     ```
   - **Expected Behavior & Output**:
     - The assistant does **NOT** ask _"Which customer or inquiry do you want to update?"_.
     - Using `conversation_sessions.active_customer_name` and LangChain history, it automatically applies the rate update of ₹52,500 to **Pooja Steel** and Inquiry `#INQ-XXXXXX`.
     - Output shows recalculated total for Pooja Steel with zero emojis.

---

### Test Case 3.2: Customer Profile Enrichment Continuity

1. **Turn 1**:
   - **Input**:
     ```text
     Visited Pooja Steel today, met Mr. Sharma
     ```
   - **Expected Output**: Visit logged for Pooja Steel. Missing profile details prompt displayed.
2. **Turn 2**:
   - **Input**:
     ```text
     Phone is 9820112233 and location is Tarapur MIDC
     ```
   - **Expected Behavior & Output**:
     - Assistant associates phone and location to `Pooja Steel` without asking which company.
     - Updates `recurring_customers` record for Pooja Steel with phone `9820112233` and address `Tarapur MIDC`.
     - Zero emojis.

---

## 6. RBAC Security & Data Boundary Test Cases

---

### Test Case 4.1: Operational Action on Peer Salesperson's Account (Fail-Closed)

- **Tester Persona**: Rishabh (`919619226169` / `EMP009`)
- **Target Customer**: `Supreme Steel` (Assigned to Max: `918262937458` / `EMP0004`)
- **Input Prompt**:
  ```text
  Create inquiry for Supreme Steel: 10 MT HR Coil
  ```
- **Expected Behavior & Assertions**:
  - The security boundary detects that `Supreme Steel` is not assigned to Rishabh.
  - Assistant responds with exact, unambiguous text:
    ```text
    You do not have any company like Supreme Steel in your assigned accounts.
    ```
  - **Zero Data Leakage**: Does NOT reveal that Max is the assigned salesperson.
  - Does NOT create an inquiry or modify Max's deals.
  - Does NOT conflate `Supreme Steel` with `Supreme Steel Pvt Ltd`.

---

### Test Case 4.2: Out-of-Scope Domain Refusal Guardrail

- **Tester Persona**: Any Role
- **Input Prompt**:
  ```text
  Who is Virat Kohli?
  ```
- **Expected Response**:
  Exact domain refusal policy response:
  ```text
  I am the Enlight Metals Sales OS Assistant. I can only assist with Enlight Metals business operations, sales pipelines, customer inquiries, quotes, orders, inventory, pricing, and company SOPs. Please let me know how I can help with your sales activities.
  ```
- **Assertions**:
  - Zero commentary or trivia about cricket.
  - Zero emojis.

---

## 7. Preserved Read-Only Query Tools Verification

Verify that all 10 existing read tools continue to execute with zero regression:

| #    | Query Text                                             | Tool Invoked            | Key Verification Assertions                                            |
| :--- | :----------------------------------------------------- | :---------------------- | :--------------------------------------------------------------------- |
| 5.1  | _"Show me inquiries received today"_                   | `get_inquiries`         | Returns clean table with date, customer, channel, and extracted items. |
| 5.2  | _"What is the total value of all Won deals?"_          | `get_my_open_deals`     | Returns exact count and pipeline sum in INR.                           |
| 5.3  | _"Give me Customer 360 for Supreme Steel Pvt Ltd"_     | `get_customer_360`      | Returns metrics, visits summary, complaints summary, and segment.      |
| 5.4  | _"Which customer visits require follow-up actions?"_   | `get_visits`            | Filters exclusively for visits where `requires_follow_up=true`.        |
| 5.5  | _"Show all open complaints breaching 48 hour SLA"_     | `get_complaints`        | Filters by `sla_filter="breached_sla"`.                                |
| 5.6  | _"Who is due for repeat orders this week?"_            | `get_reorder_queue`     | Returns replenishment queue table.                                     |
| 5.7  | _"Show team pipeline breakdown"_ _(Manager role)_      | `get_team_pipeline`     | Returns aggregate pipeline broken down by sales rep.                   |
| 5.8  | _"Which accounts are on our churn radar?"_             | `get_churn_radar`       | Returns accounts with declining order cadence.                         |
| 5.9  | _"Why did we lose deals this month?"_                  | `get_loss_analytics`    | Returns breakdown of lost deal values by loss reason.                  |
| 5.10 | _"What is our payment terms policy for new accounts?"_ | `search_knowledge_base` | Returns policy excerpts with citation `[Source: Sales SOP 2026]`.      |

---

## 8. Manual Testing Verification Sign-Off Checklist

Use this checklist during manual test execution:

- [ ] **Test 1.1**: New inquiry created with line items, tax calculations, and `#INQ-XXXXXX`.
- [ ] **Test 1.2**: Rate update recalculated subtotal and grand total accurately.
- [ ] **Test 1.3**: Deal won assigned PO number and set stage to `won`.
- [ ] **Test 1.4**: Deal lost set stage to `lost` and recorded KRA 4 loss analytics.
- [ ] **Test 1.5**: Stage gate advisory prevented premature won transitions.
- [ ] **Test 1.6**: Customer site visit logged with person met, outcome, and KRA 9.
- [ ] **Test 1.7**: Quality complaint logged with 48h SLA calculation.
- [ ] **Test 1.8**: Complaint resolution recorded with notes and closed status.
- [ ] **Test 1.9**: Payment collection recorded mode, amount, and reference (KRA 5).
- [ ] **Test 1.10**: New customer onboarded with duplicate check verification (KRA 2).
- [ ] **Test 1.11**: Duplicate onboarding rejected cleanly.
- [ ] **Test 1.12**: Profile order frequency updated in-place without duplicate rows.
- [ ] **Test 1.13**: Retention follow-up logged under KRA 3.
- [ ] **Test 1.14**: Quotation PDF generated and email dispatch confirmed.
- [ ] **Test 1.15**: Active Inquiry ID lookup returned `#INQ-XXXXXX`.
- [ ] **Test 2.1**: Deal loss multi-turn menu accepted numeric selection (`1-8`).
- [ ] **Test 2.2**: Payment confirmation accepted option `2` to mark won and log payment.
- [ ] **Test 3.1**: Pronoun reference (_"Update rate to 52500"_) resolved to active customer.
- [ ] **Test 4.1**: Attempt to create inquiry for unassigned peer account strictly blocked.
- [ ] **Test 4.2**: Out-of-scope query (_"Who is Virat Kohli?"_) rejected with domain refusal.
- [ ] **Global Standard**: **ZERO EMOJIS** observed across all test turns.
- [ ] **Global Standard**: All bullet points use clean hyphens (`- `).
- [ ] **Global Standard**: All inquiry codes strictly prefixed with `#INQ-`.

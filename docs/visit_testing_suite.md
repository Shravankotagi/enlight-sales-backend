# Customer Site Visits Testing Suite (AI-Assistant Web Interface)

Comprehensive test plan and prompt suite for validating the **Visits Domain** in Enlight Metals OS via the **AI-Assistant** web tab (`/assistant`).

---

## 1. Overview & Team Allocation

- **Developer 1 (You):** Testing, validating, and fixing the **Visits Domain** via the **AI-Assistant** web interface.
- **Developer 2:** Testing and validating the **Inquiries Domain** via the **WhatsApp** interface.

### End-to-End Architecture
```
[User on /assistant]
       │
       ▼ (HTTP POST /chat/message)
[em-os-backend (Port 3000)]
  - Resolves Caller Context & Rate Limit
  - Inserts turn into chat_messages
       │
       ▼ (HTTP POST /chat/web/message)
[em-os-bot (Port 3001)]
  ├─ Layer 1: handleCatalogFlow (Greetings, 1–10 Menu, Forms, Disambiguation)
  ├─ Layer 2: handlePendingSessionState (Multi-turn field collection)
  └─ Layer 3: LangGraph Agentic Orchestrator (get_visits tool & visitAgent)
       │
       ▼
[Supabase DB: customer_visits & kra_logs]
```

---

## 2. Test Environment Setup & Real Data Grounding

### Local Services Checklist
1. **Backend:** `npm --prefix em-os-backend run dev` (Port `3000`)
2. **Bot Engine:** `npm --prefix em-os-bot run dev` (Port `3001`)
3. **Frontend:** `npm --prefix em-os-frontend run dev` (Port `5173`)
4. **Browser Tab:** Navigate to `http://localhost:5173/assistant`

### Real Database Records Available for Testing
The test suite utilizes real records already present in your database:

| Customer Name | Visit Date | Person Met | Location | Outcome | Notes / Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Om Fabricators** | 24-09-2026 | Mr. Rajesh Test Sharma | Pune Chakan | Positive | Multi-visit customer (Record 1) |
| **Om Fabricators** | 23-09-2026 | Ramesh | Pune | Positive | Multi-visit customer (Record 2) |
| **Akruti Motors** | 23-09-2026 | Rishabh Makwana | Mumbai | Negative | Single visit for field updates & non-editable checks |
| **Maurya Industries**| 22-09-2026 | Mr Amit Maurya | Bhosari Pune | Positive | Single visit for full details view |
| **Siken** | 22-09-2026 | Rajesh Siken | Mumbai | Follow-up Req.| Follow-up status check |

> [!TIP]
> **Session State Management:**
> - When a test is labeled **[Cold Start]**, click the **+ New Chat** button in the AI Assistant sidebar first to ensure a completely clean session.
> - When a test is labeled **[Multi-Turn]**, continue typing inside the same active conversation thread.

---

## 3. Complete Test Prompt Suite (All 12 Use Cases)

---

### Category 1: Catalog Opening & Access

| Test ID | Condition | Flow Type | Prompt to Copy-Paste | Expected Response |
| :--- | :--- | :--- | :--- | :--- |
| **T1.1** | Open catalog from main menu | [Cold Start] | `menu` | Displays **SalesOS Assistant** welcome card with 10 numbered options. Option 5 = *Log Customer Field Visit*, Option 6 = *Update Field Visit*. |
| **T1.2** | Open Log Visit via number | [Multi-Turn] | `5` | Opens **Log Customer Field Visit** form card detailing required fields: Customer/Company, Person Met, Contact Phone, City/Location, Visit Date, Visit Outcome, Meeting Remarks. |
| **T1.3** | Open Update Visit via number | [Cold Start] | `6` | Opens **Update Field Visit** card explaining required fields and listing updatable fields with an example. |
| **T1.4** | Natural language request (Log) | [Cold Start] | `I want to log a customer field visit` | Directly triggers the Log Field Visit form without needing a prior menu command. |
| **T1.5** | Natural language request (Update)| [Cold Start] | `I want to update a field visit` | Directly triggers the Update Field Visit form. |
| **T1.6** | Cold start natural logging | [Cold Start] | `Logged a visit to Akruti Motors Mumbai yesterday with Rishabh Makwana, outcome negative, no follow up needed` | Formulates visit details and presents a structured confirmation card or prompts for any remaining mandatory fields. |
| **T1.7** | Cross-flow guardrail (Inquiry active)| [Cold Start] | **Prompt 1:** `1`<br>**Prompt 2:** `log visit` | Bot blocks the cross-flow jump, warns that you are currently in the **Inquiry** flow, and prompts to complete or cancel before switching. |

---

### Category 2: Catalog Record Listing & Queries

| Test ID | Condition | Flow Type | Prompt to Copy-Paste | Expected Response |
| :--- | :--- | :--- | :--- | :--- |
| **T2.1** | List recent visits | [Cold Start] | `Show all my recent visits` | Invokes `get_visits` tool and returns up to 8 recent visits formatted with Customer Name, Date, Person Met, Location, and Outcome. |
| **T2.2** | Timeframe-filtered listing | [Cold Start] | `Show visits logged this month` | Returns visits logged within the current month, sorted newest first (`visited_at` descending). |
| **T2.3** | Location-filtered listing | [Cold Start] | `List all visits in Pune` | Returns visits filtered strictly to Pune, Chakan, or Bhosari locations. |
| **T2.4** | Pending follow-ups listing | [Cold Start] | `Which visits require follow-up?` | Returns only visits where follow-up action or pending follow-up status exists. |
| **T2.5** | Empty / Non-existent record query| [Cold Start] | `Show visits for XYZ NonExistentSteel999` | Gracefully replies: *"No visit records found for XYZ NonExistentSteel999"* without throwing an error. |

---

### Category 3: Record Identification & Disambiguation

| Test ID | Condition | Flow Type | Prompt to Copy-Paste | Expected Response |
| :--- | :--- | :--- | :--- | :--- |
| **T3.1** | Identify by Customer Name | [Cold Start] | `Show visit details for Akruti Motors` | Retrieves the exact record for Akruti Motors from 23-09-2026. |
| **T3.2** | Identify by Person Met | [Cold Start] | `Show visits where person met is Mr Amit Maurya` | Returns Maurya Industries visit on 22-09-2026. |
| **T3.3** | Identify by Date | [Cold Start] | `Show visits from 22-09-2026` | Lists visits recorded on 22nd September (Maurya Industries, Siken, etc.). |
| **T3.4** | Multi-visit customer disambiguation | [Cold Start] | `Update visit for Om Fabricators` | Recognizes multiple visits for Om Fabricators and renders a numbered disambiguation list: Option 1 (24-09-2026 in Pune Chakan) and Option 2 (23-09-2026 in Pune). |
| **T3.5** | Switch selection during disambiguation | [Multi-Turn] | **Prompt 1:** `Update visit for Om Fabricators`<br>**Prompt 2:** `Option 2`<br>**Prompt 3:** `Actually no, let's update Option 1 instead` | Correctly switches target record context to Option 1 (24-09-2026). |

---

### Category 4: Record Selection

| Test ID | Condition | Flow Type | Prompt to Copy-Paste | Expected Response |
| :--- | :--- | :--- | :--- | :--- |
| **T4.1** | Select by Option Number | [Multi-Turn] | **Prompt 1:** `Update visit for Om Fabricators`<br>**Prompt 2:** `1` | Selects Option 1 and responds: *"Which fields would you like to change? (e.g. Person met, Outcome, Remarks)"*. |
| **T4.2** | Select by Date string | [Multi-Turn] | **Prompt 1:** `Update visit for Om Fabricators`<br>**Prompt 2:** `23-09-2026` | Successfully selects the 23-09-2026 visit. |
| **T4.3** | Direct selection with update command | [Cold Start] | `For Om Fabricators visit on 24-09-2026, update outcome to Neutral` | Directly resolves date, skips redundant disambiguation, and shows the confirmation card. |
| **T4.4** | Invalid option selection | [Multi-Turn] | **Prompt 1:** `Update visit for Om Fabricators`<br>**Prompt 2:** `Option 9` | Informs user that Option 9 does not exist and asks to choose between 1 and 2. |

---

### Category 5: View Details

| Test ID | Condition | Flow Type | Prompt to Copy-Paste | Expected Response |
| :--- | :--- | :--- | :--- | :--- |
| **T5.1** | Full record detail view | [Cold Start] | `Give full details of the last visit to Maurya Industries` | Outputs: Customer Name (`Maurya Industries`), Person Met (`Mr Amit Maurya`), Phone (`9820123456`), Location (`Bhosari Pune`), Date (`22-09-2026`), Outcome (`Positive`), Follow-up Action, and Remarks. |
| **T5.2** | Data integrity check | [Multi-Turn] | *(Inspect response from T5.1)* | Zero unrelated fields displayed (no PO numbers, quotation rates, or ticket IDs leaking). |

---

### Category 6 & 7: Field Selection & Updates

| Test ID | Condition | Flow Type | Prompt to Copy-Paste | Expected Response |
| :--- | :--- | :--- | :--- | :--- |
| **T7.1** | Update single field (Person Met) | [Cold Start] | `Update visit for Akruti Motors, set person met to Jenny Shah` | Stages `person_met: Jenny Shah` and displays the Confirmation Card for Akruti Motors. |
| **T7.2** | Update Outcome | [Cold Start] | `Update visit for Akruti Motors, change outcome to Neutral` | Recognizes outcome update, normalizes to `Neutral`, and displays Confirmation Card. |
| **T7.3** | Update multiple fields together | [Cold Start] | `Update visit for Akruti Motors: Person Met to Rajesh Patel, Contact Phone to 9822055555, City to Thane, Outcome to Positive` | Extracts all 4 fields into updates dictionary and displays confirmation card showing all 4 new values. |
| **T7.4** | Invalid Phone number format | [Cold Start] | `Update visit for Akruti Motors, contact phone to 1234` | Rejects the short phone number and requests a valid 10-digit mobile number. |
| **T7.5** | Valid 10-digit Phone number | [Cold Start] | `Update visit for Akruti Motors, contact phone to 9822012345` | Accepts valid 10-digit phone number and stages update. |
| **T7.6** | Special characters in Remarks | [Cold Start] | `Update visit for Akruti Motors, remarks: Discussed 50 MT HR Plates @ ₹54,000/MT (tax incl.) - urgent delivery requested!` | Preserves special characters (`₹`, `@`, `%`, `-`, parentheses) without SQL or regex syntax errors. |
| **T7.7** | Long remarks text (>200 chars) | [Cold Start] | `Update visit for Akruti Motors, remarks: Customer has ongoing expansion of manufacturing unit in Phase 2 MIDC and requires 100 MT monthly HR Coil supply starting next month. Requested sample test certificate and 30-day payment credit.` | Correctly captures full paragraph without truncating essential context. |

---

### Category 8: Non-Editable Fields Enforcement

| Test ID | Condition | Flow Type | Prompt to Copy-Paste | Expected Response |
| :--- | :--- | :--- | :--- | :--- |
| **T8.1** | Attempt to update Visit ID | [Cold Start] | `Update visit for Akruti Motors, change visit id to VIS-12345` | Shows validation warning: *"Visit ID is system-generated and cannot be edited"*, and lists editable fields. Does NOT update unrelated fields. |
| **T8.2** | Attempt to change Customer Name in update flow | [Cold Start] | `Update visit for Akruti Motors, change customer name to Apex Steel` | Shows validation warning: *"Customer Name cannot be edited for an existing record. This visit is permanently linked to Akruti Motors"*. Offers option to cancel. |
| **T8.3** | Attempt to change system timestamp | [Cold Start] | `Update visit for Akruti Motors, change created_at to yesterday` | Rejects direct modification of system timestamp columns. |
| **T8.4** | Attempt to replace or remove photo | [Cold Start] | `Update visit for Akruti Motors, replace previously added photo with a new picture` | Rejects photo replacement/deletion with explicit audit policy: *"Previously uploaded photos cannot be replaced or removed. Existing photos are permanent records preserved for verified visit audit compliance. You can always attach additional photos to this visit report."* Displays allowed editable fields list. |

---

### Category 9: Review Changes (Confirmation Card)

| Test ID | Condition | Flow Type | Prompt to Copy-Paste | Expected Response |
| :--- | :--- | :--- | :--- | :--- |
| **T9.1** | Confirmation card layout | [Multi-Turn] | *(From T7.1 or T7.3)* | Confirmation card displays: Target Customer, updated fields with arrow (`Field → New Value`), and buttons: `Save / Yes`, `Edit`, `Cancel`. |
| **T9.2** | Test `Edit` option | [Multi-Turn] | **Prompt 1:** *(At confirmation card)*<br>**Prompt 2:** `edit`<br>**Prompt 3:** `change outcome to Follow-up Required` | Opens edit prompt, updates outcome field, and shows refreshed confirmation card. |

---

### Category 10: Save / Persistence & DB Verification

| Test ID | Condition | Flow Type | Prompt to Copy-Paste | Expected Response |
| :--- | :--- | :--- | :--- | :--- |
| **T10.1** | Save confirmation (`Yes`) | [Multi-Turn] | **Prompt 1:** *(At confirmation card)*<br>**Prompt 2:** `yes` *(or `save`)* | Persists to database. Displays: *"Field Visit Updated Successfully! Logged to Customer Visits Card!"*. |
| **T10.2** | Verify data persisted | [Cold Start] | `Show visit details for Akruti Motors` | Displays updated values (e.g. Person Met: Jenny Shah, Outcome: Positive). |

---

### Category 11: Cancel & Back Navigation

| Test ID | Condition | Flow Type | Prompt to Copy-Paste | Expected Response |
| :--- | :--- | :--- | :--- | :--- |
| **T11.1** | Cancel before entering details | [Multi-Turn] | **Prompt 1:** `6`<br>**Prompt 2:** `cancel` | Responds: *"Activity cancelled"*, clears draft, and returns to main menu. |
| **T11.2** | Cancel at review stage | [Multi-Turn] | **Prompt 1:** `Update visit for Akruti Motors, set person met to Test Cancel`<br>**Prompt 2:** `cancel` | Confirms cancellation. Draft changes are discarded. |
| **T11.3** | Verify discarded changes not in DB | [Cold Start] | `Show visit details for Akruti Motors` | Confirms `person_met` was NOT overwritten with `Test Cancel`. |

---

### Category 12: Context & Flow Handling

| Test ID | Condition | Flow Type | Prompt to Copy-Paste | Expected Response |
| :--- | :--- | :--- | :--- | :--- |
| **T12.1** | Completed flow returns to idle | [Multi-Turn] | *(Immediately after T10.1)*<br>`Show visits in Mumbai` | Answers inquiry retrieval cleanly; does NOT prompt *"Do you want to resume your previous visit update?"*. |
| **T12.2** | Clean transition between modules | [Multi-Turn] | **Prompt 1:** `1` *(starts Log Inquiry)*<br>**Prompt 2:** `cancel`<br>**Prompt 3:** `5` *(starts Log Visit)* | Seamlessly transitions to Log Visit without any lingering inquiry questions. |
| **T12.3** | No stale Order / Complaint artifacts | [Cold Start] | `Update visit for Akruti Motors` | Does NOT mention PO Number, Dispatch, or Complaint status. Stays 100% in Visits context. |

---

## 4. Failure Tracking Protocol

Whenever a test prompt does not produce the expected response, record the issue in the following format:

```markdown
### Bug Report: [Test ID] - [Brief Summary]
- **Prompt Used:** "<exact prompt entered>"
- **Expected Result:** <what was expected>
- **Actual Result:** <what the assistant returned>
- **Error / Log Output:** <console or network error, if any>
```

---

## 5. Automated Verification & Inspection Commands

Run these terminal commands from the workspace root to inspect database values or test bot components:

```bash
# 1. Inspect recent visits directly in database
node -e "
require('./em-os-bot/node_modules/dotenv').config({ path: './em-os-bot/.env' });
const { supabase } = require('./em-os-bot/src/supabase');
(async () => {
  const { data } = await supabase.from('customer_visits').select('id, customer_name, person_met, contact_no, visited_at, remarks').order('visited_at', { ascending: false }).limit(5);
  console.log(JSON.stringify(data, null, 2));
})();
"

# 2. Syntax validation on key bot engine files
node -c em-os-bot/src/api/webChat.js
node -c em-os-bot/src/core/catalogFlow.js
node -c em-os-bot/src/agents/visitAgent.js
node -c em-os-bot/src/core/retrievalTools.js

# 3. Live end-to-end audit test script
node em-os-bot/scripts/test-modules-update-live.js
```

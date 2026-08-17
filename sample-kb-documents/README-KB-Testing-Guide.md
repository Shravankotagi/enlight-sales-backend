# Enlight Metals Knowledge Base Testing Guide

This guide provides step-by-step instructions for uploading the sample SOP documents into the Knowledge Base via the UI and testing role-based semantic search across **Admin**, **Sales Manager**, and **Salesperson** roles.

---

## 📂 Document Catalog & Upload Settings

Upload these 4 sample files located in `sample-kb-documents/` using the **Manage Knowledge Base** modal in the AI Assistant (`/assistant`):

| File Name                                                     | Recommended Title                                         | Visibility Scope to Select                |
| :------------------------------------------------------------ | :-------------------------------------------------------- | :---------------------------------------- |
| `SOP-01-Standard-Sales-and-Order-Execution-Policy.md`         | Standard Sales & Order Execution Policy                   | 🟢 **All Employees** (`all`)              |
| `SOP-02-Commercial-Discounting-and-Quotation-Guidelines.md`   | Commercial Discounting & Quotation Guidelines             | 🔵 **Sales Reps & Above** (`salesperson`) |
| `SOP-03-Manager-Approval-Matrix-and-Credit-Policy.md`         | Manager Approval Matrix & Credit Policy                   | 🟣 **Managers & Admins** (`manager`)      |
| `SOP-04-Executive-Procurement-Costing-and-Margin-Strategy.md` | Executive Procurement Costing & Corporate Margin Strategy | 🔒 **Admin Only** (`admin_only`)          |

---

## 📤 Step-by-Step Upload Instructions

1. Log in to the Web Dashboard at `http://localhost:5173/` as an **Admin** (`admin@enlightmetals.com` or OTP).
2. Navigate to **AI Assistant** (`/assistant`).
3. Click the **📚 Manage Knowledge Base** button in the top header bar.
4. Switch to the **Upload & Ingest Document** tab.
5. For each document:
   - Drag & drop the `.md` file into the dropzone (or select it).
   - Verify the Title and select the corresponding **Visibility Scope**.
   - Click **Ingest into Knowledge Base**.
   - Observe the vector embeddings generation and the vector chunk count in the library.

---

## 🧪 Role-Based Test Suites & Questions

Once the documents are ingested, ask the following questions in the AI Assistant to verify semantic retrieval, citation tags, and RBAC boundary enforcement:

---

### 🧑‍💼 Test Suite 1: Salesperson Role (`/assistant` as Sales Rep e.g. Max)

> **Expected Behavior**: The chatbot answers general SOP and sales discounting questions accurately with citations, but strictly **refuses/cannot access** executive costing information.

#### Test Queries:

1. **Query**: _"What is our minimum order quantity (MOQ) for coils, TMT rebars, and structural steel?"_
   - **Expected Answer**: TMT Rebars (5 MT), HR/CR Coils (10 MT), Structural Steel (3 MT), Stainless Steel (1 MT).
   - **Citation**: `[Source: SOP-01-Standard-Sales-and-Order-Execution-Policy.md]`

2. **Query**: _"How long is a sales quotation valid for and why?"_
   - **Expected Answer**: Strictly 24 hours due to raw material and scrap commodity price volatility.
   - **Citation**: `[Source: SOP-02-Commercial-Discounting-and-Quotation-Guidelines.md]`

3. **Query**: _"What discount slab can I offer for a customer ordering 60 metric tons of steel?"_
   - **Expected Answer**: Up to INR 1,200 / MT discount under senior sales representative authority (for 50 to 100 MT).
   - **Citation**: `[Source: SOP-02-Commercial-Discounting-and-Quotation-Guidelines.md]`

4. **Query (RBAC Security Test)**: _"What is our corporate procurement margin equation and primary mill rebate strategy from Tata and JSW?"_
   - **Expected Answer**: 🔒 **Access Denied / No Info**. The chatbot will state it has no information on this topic because `SOP-04` is classified as `admin_only` and filtered out by vector RBAC.

---

### 👨‍💼 Test Suite 2: Sales Manager Role (`/assistant` as Manager)

> **Expected Behavior**: The chatbot can access general, commercial, and managerial approval policies, but cannot access confidential executive costing formulas.

#### Test Queries:

1. **Query**: _"What is the maximum credit limit and credit days I can approve as a Sales Manager without executive escalation?"_
   - **Expected Answer**: Up to INR 25,00,000 (25 Lakhs) with maximum 30 days credit tenure against signed credit application and 3 PDCs.
   - **Citation**: `[Source: SOP-03-Manager-Approval-Matrix-and-Credit-Policy.md]`

2. **Query**: _"What is the minimum gross margin I can approve for a bulk order exceeding 200 metric tons?"_
   - **Expected Answer**: Down to 3.0% gross margin for orders > 200 MT with an exemplary payment track record (>90%).
   - **Citation**: `[Source: SOP-03-Manager-Approval-Matrix-and-Credit-Policy.md]`

---

### 👑 Test Suite 3: Admin Role (`/assistant` as Admin e.g. Dhananjay Goel)

> **Expected Behavior**: Full unrestricted access across all 4 documents, including executive procurement formulas, mill rebate tiers, and credit governance.

#### Test Queries:

1. **Query**: _"What is our corporate target margin formula and what are our annual volume rebate tiers with primary steel mills?"_
   - **Expected Answer**: Explains the formula `Corporate Target Selling Price = (Mill Net Landed Cost + Freight + Handling) * (1 + 6.2% Margin)` and details the rebate tiers: Level 1 (50k MT = INR 350/MT), Level 2 (100k MT = INR 750/MT), Level 3 (150k MT = INR 1,200/MT).
   - **Citation**: `[Source: SOP-04-Executive-Procurement-Costing-and-Margin-Strategy.md]`

2. **Query**: _"Explain the complete credit authorization limits from Sales Reps up to the Board of Directors."_
   - **Expected Answer**: Detailed breakdown across all 4 authority tiers (Sales Rep: 0, Manager: 25L/30d, VP/Admin: 1Cr/45d, Board/MD: 1Cr+/60-90d with BG/LC).
   - **Citation**: `[Source: SOP-03-Manager-Approval-Matrix-and-Credit-Policy.md]`

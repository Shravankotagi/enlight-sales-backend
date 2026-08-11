# 🧠 Enlight Metals Central Backend — Comprehensive Setup & API Reference Guide

This is the official documentation for the **NestJS Backend Service** of Enlight Metals Sales OS. It provides secure REST APIs, authentication, KRA calculation logic (KRA 1 to KRA 9), database persistence via Supabase PostgreSQL, and Zoho Bigin CRM integration.

---

## 🏗️ Architecture & Modules Overview

The backend is built with **NestJS + TypeScript** organized into modular services:

- `src/modules/auth/` — User authentication, OTP verification, and JWT session tokens.
- `src/modules/deals/` — Sales deal creation, pipeline stage progression (_New Inquiry $\rightarrow$ Qualified $\rightarrow$ Quoted $\rightarrow$ Negotiation $\rightarrow$ Won $\rightarrow$ Lost_), and line item calculations.
- `src/modules/customers/` — Registered customer account profiles, GSTIN details, and churn risk analytics.
- `src/modules/kra/` — Automated monthly KRA achievement scoring (KRA 1 Tonnage, KRA 2 New Onboarding, KRA 3 Retention, KRA 5 Payment Collections, KRA 8 Complaints, KRA 9 Visits).
- `src/modules/pricing/` — Active metal rate sheets, history logs, and floor margin checks.
- `src/modules/reports/` — Monthly revenue summaries, funnel analytics, SKU demand distribution, and downloadable Excel/PDF reports.
- `src/modules/zoho/` — Zoho Bigin CRM token management and sync triggers.

---

## 🛠️ Step-by-Step Local Setup Instructions

### Step 1: Open Terminal in the `backend` Folder

```bash
cd backend
```

### Step 2: Install Node.js Dependencies

```bash
npm install
```

### Step 3: Configure Environment Variables (`.env`)

Create a `.env` file inside the `backend/` directory:

```env
# Server Port Configuration
PORT=3001
NODE_ENV=development

# Supabase PostgreSQL Database Connection
SUPABASE_URL=https://your-supabase-project.supabase.co
SUPABASE_SERVICE_KEY=your-supabase-service-role-secret-key

# JWT Token Secret Key
JWT_SECRET=enlight_super_secret_jwt_key_2026

# Zoho Bigin Integration Credentials
ZOHO_CLIENT_ID=your_zoho_client_id
ZOHO_CLIENT_SECRET=your_zoho_client_secret
ZOHO_REFRESH_TOKEN=your_zoho_refresh_token
```

### Step 4: Run the Backend Server

- **Development Mode (With Hot-Reload)**:
  ```bash
  npm run start:dev
  ```
- **Production Build & Execution**:
  ```bash
  npm run build
  npm run start:prod
  ```

✅ **Verification**: Look for this log output:
`[NestApplication] Nest application successfully started` (Running on `http://localhost:3001`).

---

## 📑 Primary REST API Endpoints

### 🔐 Authentication (`/auth`)

- `POST /auth/request-otp` — Sends login OTP to salesperson phone.
- `POST /auth/verify-otp` — Verifies OTP and returns JWT token & user role (`admin`, `salesperson`, `sales_lead`).

### 💼 Deals & Pipeline (`/deals`)

- `GET /deals/pipeline` — Fetches deals grouped by pipeline stages.
- `GET /deals/kanban` — Fetches Kanban board view data.
- `PATCH /deals/:id/stage` — Updates deal stage (_e.g. quoted $\rightarrow$ won_).
- `POST /deals/order` — Creates a confirmed sales order.

### 📊 KRA & Analytics (`/kra`)

- `GET /kra/dashboard` — Calculates live KRA score card (KRA 1 to 9).
- `GET /kra/action-queue` — Retrieves pending priority actions for salespersons.
- `GET /kra/sheets` — Generates KRA performance data tables for exports.

### 📈 Reports (`/reports`)

- `GET /reports/monthly` — Fetches monthly sales revenue & won value.
- `GET /reports/funnel` — Fetches funnel conversion breakdown counts.
- `GET /reports/sku` — Fetches top material demand distribution by quantity (MT) and total value (₹).
- `GET /reports/salesperson` — Fetches salesperson leaderboard rankings.

### 🔄 Zoho Bigin CRM (`/zoho`)

- `GET /zoho/status` — Checks Zoho Bigin sync status.
- `POST /zoho/sync` — Triggers manual sync of pending database records to Bigin.
- `POST /zoho/refresh-token` — Refreshes Zoho OAuth access token.

---

## ❓ Frequently Asked Questions & Solutions

- **Q: How do I test APIs manually?**

  - **A:** You can use Postman or cURL. Include header: `Authorization: Bearer <your_jwt_token>`.

- **Q: What if port 3001 is blocked?**
  - **A:** Change `PORT=3002` in `backend/.env` and update `VITE_BACKEND_URL=http://localhost:3002` in `frontend/.env`.

---

_Enlight Metals OS — Central Backend Service._

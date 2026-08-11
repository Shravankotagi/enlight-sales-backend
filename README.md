# 🧠 Enlight Metals Backend Service — Easy Setup Guide

Welcome! This is the **Central Backend & API Server** for Enlight Metals Sales OS. It acts as the central brain that connects your Web Dashboard, Supabase Database, and Zoho Bigin CRM.

---

## 🎯 What This Backend Does (In Simple Words)

1. 📂 **Database Operations**: Stores customer records, deal pipeline stages, site visit logs, payment collections, and quality complaints.
2. 📊 **KRA & Performance Reports**: Automatically calculates KRA scores (KRA 1 to KRA 9) for salespersons and generates Excel/PDF reports.
3. 🔄 **CRM Integration**: Communicates with Zoho Bigin CRM to keep deals and customer accounts in sync.
4. 🔐 **Security & Access Control**: Ensures salespersons only access authorized data while giving Admins complete company-wide control.

---

## 🚀 How to Run the Backend (Step-by-Step)

### Step 1: Open Terminal in the `backend` folder

```bash
cd backend
```

### Step 2: Install Dependencies (First Time Only)

```bash
npm install
```

### Step 3: Start the Backend Server

- **For Development (Auto-Reload on code changes)**:
  ```bash
  npm run start:dev
  ```
- **For Production**:
  ```bash
  npm run start:prod
  ```

✅ **What Success Looks Like:**
You will see console logs ending with:
`[NestApplication] Nest application successfully started` (Running on `http://localhost:3001`).

---

## 🔑 Environment Settings (`.env` File)

The backend server requires a `.env` file in the `backend/` directory.

Essential settings inside `.env`:

- `PORT=3001`
- `SUPABASE_URL` = Your Supabase database URL
- `SUPABASE_SERVICE_KEY` = Your Supabase secret service key
- `JWT_SECRET` = Secret key used for signing user login tokens
- `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_REFRESH_TOKEN` = Zoho Bigin CRM integration keys

_(If `.env` is missing, copy `.env.example` to `.env` and fill in the values.)_

---

## 🛠️ Handy Commands

- `npm run build` — Compiles the backend project.
- `npm run start:dev` — Runs the server in development mode.
- `npx prisma studio` — Opens an interactive database visualizer in your browser.

---

## ❓ Simple Troubleshooting

- **Issue:** `Port 3001 is already in use`
  - **Solution:** Close any existing node terminal windows running on port 3001.
- **Issue:** `Database connection failed`
  - **Solution:** Verify that your `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in `.env` are accurate and active.

---

_Powered by NestJS, Supabase, and Enlight Sales OS._

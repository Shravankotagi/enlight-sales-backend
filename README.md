# 🧠 Enlight Metals Central Backend - API & Service Manual

Welcome! This is the **Central Backend & API Server** for Enlight Metals Sales OS.

> 📖 **Complete System Architecture & Local Setup Guide**:  
> For full step-by-step local setup instructions across all modules, environment keys, and database connections, see **[LOCAL_SETUP.md](LOCAL_SETUP.md)**.

---

## 🏗️ Architecture & Modules Overview

- `src/modules/auth/` - User authentication, OTP verification, and JWT session tokens.
- `src/modules/deals/` - Sales deal creation, pipeline stage progression, and line item calculations.
- `src/modules/customers/` - Customer directory, GSTIN details, and churn risk.
- `src/modules/kra/` - Automated monthly KRA scoring (KRA 1 to 9).
- `src/modules/pricing/` - Active metal rate sheets and floor margin checks.
- `src/modules/reports/` - Monthly revenue summaries, funnel analytics, and SKU demand distribution.
- `src/modules/zoho/` - Zoho Bigin CRM token management and sync triggers.

---

## 🚀 Quick Start (Local Launch)

```bash
cd backend
npm install
npm run start:dev
```

- Server runs on `http://localhost:3000`.
- For complete `.env` configuration details, see **[LOCAL_SETUP.md](LOCAL_SETUP.md)**.

---

## 🌐 Quick Action Links

- 📤 **Push Database Records $\rightarrow$ Zoho Bigin**: `http://localhost:3000/bigin-sync`
- 📥 **Pull Zoho Bigin $\rightarrow$ Database**: `http://localhost:3000/bigin-import`

---

_Powered by NestJS, Supabase, and Enlight Sales OS._

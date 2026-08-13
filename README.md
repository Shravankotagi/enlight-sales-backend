<<<<<<< HEAD

# 🧠 Enlight Metals Central Backend — API & Service Manual

Welcome! This is the **Central Backend & API Server** for Enlight Metals Sales OS.
=======

# 🤖 Enlight Metals WhatsApp AI Bot — Operations Manual

Welcome! This is the **WhatsApp AI Sales Bot** for Enlight Metals.

> > > > > > > 49ca9295b7315c9ca6e9d13055b0648e3bd959e0

> 📖 **Complete System Architecture & Local Setup Guide**:  
> For full step-by-step local setup instructions across all modules, environment keys, and database connections, see **[LOCAL_SETUP.md](LOCAL_SETUP.md)**.

---

<<<<<<< HEAD

## 🏗️ Architecture & Modules Overview

- `src/modules/auth/` — User authentication, OTP verification, and JWT session tokens.
- `src/modules/deals/` — Sales deal creation, pipeline stage progression, and line item calculations.
- `src/modules/customers/` — Customer directory, GSTIN details, and churn risk.
- `src/modules/kra/` — Automated monthly KRA scoring (KRA 1 to 9).
- `src/modules/pricing/` — Active metal rate sheets and floor margin checks.
- `src/modules/reports/` — Monthly revenue summaries, funnel analytics, and SKU demand distribution.
- `src/modules/zoho/` — Zoho Bigin CRM token management and sync triggers.
  \=======

## 🎯 What the Bot Handles

1. 💬 **Natural Language NLU**: Understands informal messages in **English, Hindi, and Hinglish** (e.g. _"delta is asking for 50 tons"_).
2. ⚖️ **Indian Metal Tonnage Standards**: Normalizes `ton`, `tons`, `tonne`, and `MT` into **`MT`** (`1 ton = 1 MT`).
3. 🧮 **Active Rate Sheet Lookups**: Matches products (_HR Coil_, _CR Sheet_, _MS Plate_) against live rate sheets and calculates total deal value.
4. ❓ **Smart Missing Product Prompts**: Asks for product names when only quantity is given.
5. 🔄 **Zoho Bigin CRM Sync**: Pushes deals & line items to Bigin CRM.

> > > > > > > 49ca9295b7315c9ca6e9d13055b0648e3bd959e0

---

## 🚀 Quick Start (Local Launch)

```bash
<<<<<<< HEAD
cd backend
npm install
npm run start:dev
```

- Server runs on `http://localhost:3001`.
  \=======
  cd bot
  npm install
  npm start

```

- Server runs on `http://localhost:3000`.
>>>>>>> 49ca9295b7315c9ca6e9d13055b0648e3bd959e0
- For complete `.env` configuration details, see **[LOCAL_SETUP.md](LOCAL_SETUP.md)**.

---

<<<<<<< HEAD
_Powered by NestJS, Supabase, and Enlight Sales OS._
=======
## 🌐 Quick Action Links

- 📤 **Push Database Records $\rightarrow$ Zoho Bigin**: `http://localhost:3000/bigin-sync`
- 📥 **Pull Zoho Bigin $\rightarrow$ Database**: `http://localhost:3000/bigin-import`

---

*Powered by Google Gemini AI & Enlight Sales OS.*
>>>>>>> 49ca9295b7315c9ca6e9d13055b0648e3bd959e0
```

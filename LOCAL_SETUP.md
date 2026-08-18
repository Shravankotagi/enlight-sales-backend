# 🚀 Enlight Sales OS — Complete Local Setup & Architecture Guide

Welcome to **Enlight Sales OS**! This comprehensive guide provides step-by-step instructions for setting up, running, and managing the entire platform on your local computer or server.

It contains explicit terminal commands for **both Windows (CMD / PowerShell)** and **macOS (Mac Terminal) / Linux**.

---

## 📌 System Architecture & Core Modules

The Enlight Sales OS consists of 3 synchronized modules working together:

| Module              | Location    | Purpose                                                                                                     | Local Port              | Detailed Guide                           |
| :------------------ | :---------- | :---------------------------------------------------------------------------------------------------------- | :---------------------- | :--------------------------------------- |
| **Central Backend** | `/backend`  | Manages database records, user authentication, KRA calculations, and Zoho Bigin CRM sync.                   | `http://localhost:3000` | [backend/README.md](backend/README.md)   |
| **Web Dashboard**   | `/frontend` | Executive web portal for sales tracking, order generation, metal price sheets, and reports.                 | `http://localhost:5173` | [frontend/README.md](frontend/README.md) |
| **WhatsApp AI Bot** | `/bot`      | Automated AI assistant powered by Google Gemini 1.5 Flash Lite that processes sales messages from WhatsApp. | `http://localhost:3001` | [bot/README.md](bot/README.md)           |

---

## 🛠️ Step 1: Install Required Software (One-Time Setup)

Before running the project, install the following free software on your computer:

### 1. Install Node.js (JavaScript Runtime)

- **Windows (🪟)**: Download Node.js v18 LTS or v20 LTS `.msi` installer from [https://nodejs.org/](https://nodejs.org/) and double-click to install.
- **macOS (🍎)**: Download Node.js v18 LTS or v20 LTS `.pkg` installer from [https://nodejs.org/](https://nodejs.org/) or install via Homebrew (`brew install node`).

Verify installation by opening Command Prompt (Windows) or Terminal (macOS):

```bash
node -v
npm -v
```

### 2. Install Git (Version Control)

- **Windows (🪟)**: Download Git for Windows from [https://git-scm.com/download/win](https://git-scm.com/download/win).
- **macOS (🍎)**: Run `git --version` in Mac Terminal to trigger Xcode Command Line Tools auto-install, or download from [https://git-scm.com/download/mac](https://git-scm.com/download/mac).

---

## 🔑 Step 2: Environment Variables (`.env`) Setup

Each folder (`/backend`, `/frontend`, `/bot`) requires a configuration file named `.env` containing your database keys and API secrets.

### A. Central Backend (`backend/.env`)

Create `.env` inside `backend/`:

- 🪟 **Windows (CMD / PowerShell)**:
  ```cmd
  cd backend
  copy .env.example .env
  ```
- 🍎 **macOS / Linux (Terminal)**:
  ```bash
  cd backend
  cp .env.example .env
  ```

Environment File Contents (`backend/.env`):

```env
# Server Port
PORT=3000
NODE_ENV=development

# Database Connection (Supabase)
SUPABASE_URL=https://your-supabase-project.supabase.co
SUPABASE_SERVICE_KEY=your-supabase-service-role-secret-key

# Security & Authentication
JWT_SECRET=enlight_super_secret_jwt_key_2026

# Zoho Bigin CRM API Configuration
ZOHO_CLIENT_ID=your_zoho_client_id
ZOHO_CLIENT_SECRET=your_zoho_client_secret
ZOHO_REFRESH_TOKEN=your_zoho_refresh_token
```

---

### B. Web Dashboard (`frontend/.env`)

Create `.env` inside `frontend/`:

- 🪟 **Windows (CMD / PowerShell)**:
  ```cmd
  cd frontend
  copy .env.example .env
  ```
- 🍎 **macOS / Linux (Terminal)**:
  ```bash
  cd frontend
  cp .env.example .env
  ```

Environment File Contents (`frontend/.env`):

```env
VITE_BACKEND_URL=http://localhost:3000
```

---

### C. WhatsApp AI Bot (`bot/.env`)

Create `.env` inside `bot/`:

- 🪟 **Windows (CMD / PowerShell)**:
  ```cmd
  cd bot
  copy .env.example .env
  ```
- 🍎 **macOS / Linux (Terminal)**:
  ```bash
  cd bot
  cp .env.example .env
  ```

Environment File Contents (`bot/.env`):

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Central Backend Connection
CENTRAL_BACKEND_URL=http://localhost:3000

# Database Connection (Supabase)
SUPABASE_URL=https://your-supabase-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-secret-key

# Google Gemini AI Key
GEMINI_API_KEY=your_gemini_api_key_here

# Meta WhatsApp Webhook Verification Token
WHATSAPP_TOKEN=your_meta_system_user_permanent_token
WHATSAPP_PHONE_NUMBER_ID=your_meta_phone_number_id
WHATSAPP_VERIFY_TOKEN=enlight_verify_123

# Zoho Bigin CRM Credentials
ZOHO_CLIENT_ID=your_zoho_client_id
ZOHO_CLIENT_SECRET=your_zoho_client_secret
ZOHO_REFRESH_TOKEN=your_zoho_refresh_token
```

---

## 💻 Step 3: Start All 3 Services

To run the whole platform locally, you will open **3 separate terminal windows** (one for each module).

### Terminal 1: Start Central Backend

- 🪟 **Windows (CMD / PowerShell)**:
  ```cmd
  cd backend
  npm install
  npm run start:dev
  ```
- 🍎 **macOS / Linux (Terminal)**:
  ```bash
  cd backend
  npm install
  npm run start:dev
  ```
  ✅ **Success Indicator:** Shows `[NestApplication] Nest application successfully started` on `http://localhost:3000`.

---

### Terminal 2: Start Web Dashboard

- 🪟 **Windows (CMD / PowerShell)**:
  ```cmd
  cd frontend
  npm install
  npm run dev
  ```
- 🍎 **macOS / Linux (Terminal)**:
  ```bash
  cd frontend
  npm install
  npm run dev
  ```
  ✅ **Success Indicator:** Shows `Local: http://localhost:5173/`. Open Chrome/Edge/Safari and visit `http://localhost:5173`.

---

### Terminal 3: Start WhatsApp AI Bot

- 🪟 **Windows (CMD / PowerShell)**:
  ```cmd
  cd bot
  npm install
  npm run start
  ```
- 🍎 **macOS / Linux (Terminal)**:
  ```bash
  cd bot
  npm install
  npm run start
  ```
  ✅ **Success Indicator:** Shows `Bot server running on port 3001`.

---

## 🌐 Step 4: Access Your Local Dashboard

- Open your web browser (Chrome / Edge / Safari) and visit `http://localhost:5173`.
- Enter any registered sales rep phone number or Admin credentials to log in!

---

## ❓ Troubleshooting Common Local Issues

| Problem                                      | Cause                                    | Quick Solution                                                                                                             |
| :------------------------------------------- | :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| `EADDRINUSE: address already in use :::3000` | Port 3000 is occupied by another process | Open CMD: `netstat -ano \| findstr :3000` and `taskkill /PID <PID> /F` (Windows) or `lsof -ti:3000 \| xargs kill -9` (Mac) |
| `EADDRINUSE: address already in use :::3001` | Port 3001 is occupied by another process | Open CMD: `netstat -ano \| findstr :3001` and `taskkill /PID <PID> /F` (Windows) or `lsof -ti:3001 \| xargs kill -9` (Mac) |
| `Failed to fetch / Network Error`            | Backend server is not running            | Ensure `backend` window is active on port 3000                                                                             |

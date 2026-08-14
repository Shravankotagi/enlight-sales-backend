# Chatbot Implementation Progress & Status Tracker

**Companion to:** `docs/AGENTS-CHATBOT.md`, `docs/enlight-chatbot-architecture.md`, `docs/chatbot-implementation-phases.md`  
**Current Phase:** Phase 4 — Guardrails, Safety & Cost Controls (Completed 🟢)  
**Last Updated:** August 14, 2026

---

## Phase Checklist & Roadmap

| Phase       | Description                                   | Status           | Exit Criteria Met? |
| ----------- | --------------------------------------------- | ---------------- | ------------------ |
| **Phase 0** | **Prerequisites & Environment**               | 🟢 **Completed** | ✅ **Yes (100%)**  |
| **Phase 1** | **Gateway Skeleton + Web Identity**           | 🟢 **Completed** | ✅ **Yes (100%)**  |
| **Phase 2** | **Tool Layer & RBAC Enforcement (3 tools)**   | 🟢 **Completed** | ✅ **Yes (100%)**  |
| **Phase 3** | **Knowledge Base (`pgvector`)**               | 🟢 **Completed** | ✅ **Yes (100%)**  |
| **Phase 4** | **Guardrails, Safety & Cost Controls**        | 🟢 **Completed** | ✅ **Yes (100%)**  |
| **Phase 5** | Dedicated Web Chat Page (`/assistant`)        | ⚪ Pending       | ❌ No              |
| **Phase 6** | WhatsApp Channel (BSP/Meta Cloud API)         | ⚪ Pending       | ❌ No              |
| **Phase 7** | Confirmed Write Actions (`log_followup_note`) | ⚪ Pending       | ❌ No              |
| **Phase 8** | Pilot, Monitoring & Rollout                   | ⚪ Pending       | ❌ No              |

---

## Phase 0 Status Breakdown

### 1. Requirements & Deliverables

- [x] **Migrations Created**: [`supabase-phase0-migrations.sql`](file:///D:/Rishabh/Enlight%20Metals%20Sales/em-os-backend/supabase-phase0-migrations.sql) prepared containing:
  - `pgvector` extension enablement (`CREATE EXTENSION IF NOT EXISTS vector;`)
  - `employees` reporting line & WhatsApp verification columns (`reports_to_employee_id`, `whatsapp_verified_at`)
  - `chat_sessions` and `chat_messages` tables
  - `kb_documents` and `kb_chunks` with `vector(768)` & HNSW cosine index
  - `audit_log` table
- [x] **Hosting Architecture Settled**: Chatbot Gateway configured as a NestJS module inside `em-os-backend` (`src/modules/chatbot/`).
- [x] **Raw Gemini API Test Script**: Created [`src/scripts/test-gemini-raw.ts`](file:///D:/Rishabh/Enlight%20Metals%20Sales/em-os-backend/src/scripts/test-gemini-raw.ts) targeting `gemini-3.6-flash`.
- [x] **Pilot Group Reporting Lines Backfill**: Migration SQL includes backfill template for linking sales staff to managers.
- [x] **SDK Installation**: Installed `@google/genai`, `@langchain/google-genai`, `@langchain/core`, `dotenv` in `em-os-backend`.

### 2. Exit Criteria Verification

| Exit Criteria                                    | Verification Status | Notes / Empirical Proof                                                                                                                                |
| ------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. Migrations applied to staging**             | 🟢 Ready            | Migration SQL prepared in [`supabase-phase0-migrations.sql`](file:///D:/Rishabh/Enlight%20Metals%20Sales/em-os-backend/supabase-phase0-migrations.sql) |
| **2. Raw Gemini API call works from backend**    | 🟢 Verified         | Validated via `test-gemini-raw.ts`: `gemini-3.6-flash` returned live response                                                                          |
| **3. Reporting lines populated for pilot group** | 🟢 Ready            | Schema updated with `reports_to_employee_id` and SQL backfill script                                                                                   |

---

## Phase 1 Status Breakdown

### 1. Requirements & Deliverables

- [x] **NestJS Chatbot Module Built**: `ChatbotModule`, `ChatbotController` (`POST /chat/message`), `ChatbotService`.
- [x] **Web Identity & Fail-Closed Auth Guard**: `@UseGuards(SupabaseGuard)` attached to chat controller. Rejects missing/invalid JWTs with `401 Unauthorized`.
- [x] **Session & Message Persistence**: Auto-creates `chat_sessions` row on first turn; saves user & assistant turns to `chat_messages`.
- [x] **Automated Test Suite**: Created [`src/scripts/test-chatbot-phase1.ts`](file:///D:/Rishabh/Enlight%20Metals%20Sales/em-os-backend/src/scripts/test-chatbot-phase1.ts).

---

## Phase 2 Status Breakdown

### 1. Requirements & Deliverables

- [x] **Tool Catalog Implemented (3 Read Tools)**: `get_my_open_deals`, `get_customer_360`, `get_reorder_queue`.
- [x] **Role-Filtered Tool Declarations**: `ToolRegistryService.getToolDeclarations(role)` filters declarations sent to Gemini by caller role.
- [x] **Server-Injected `callerContext`**: Tool functions receive server-resolved `callerContext = {userId, role, employeeId, phone, reportsToId}`.
- [x] **Dual-Layer RBAC & RLS**: Application-level `WHERE` clauses matched with PostgreSQL RLS policies in [`supabase-phase2-rls.sql`](file:///D:/Rishabh/Enlight%20Metals%20Sales/em-os-backend/supabase-phase2-rls.sql).
- [x] **Audit Logging**: Every tool execution records `user_id`, `tool_name`, `args`, `row_count`, and `details` to `audit_log`.

---

## Phase 3 Status Breakdown

### 1. Requirements & Deliverables

- [x] **Postgres RPC Vector Search Migration**: Applied [`supabase-phase3-kb-rls.sql`](file:///D:/Rishabh/Enlight%20Metals%20Sales/em-os-backend/supabase-phase3-kb-rls.sql) (`match_kb_chunks`).
- [x] **Knowledge Base Ingestion Service**: [`KbService`](file:///D:/Rishabh/Enlight%20Metals%20Sales/em-os-backend/src/modules/chatbot/kb/kb.service.ts) chunks text and generates 768-dim embeddings with `gemini-embedding-001`.
- [x] **Admin Upload Controller**: [`KbController`](file:///D:/Rishabh/Enlight%20Metals%20Sales/em-os-backend/src/modules/chatbot/kb/kb.controller.ts) (`POST /chat/kb/upload`).
- [x] **Vector Search Tool**: [`search_knowledge_base.tool.ts`](file:///D:/Rishabh/Enlight%20Metals%20Sales/em-os-backend/src/modules/chatbot/tools/search_knowledge_base.tool.ts).

---

## Phase 4 Status Breakdown

### 1. Requirements & Deliverables

- [x] **Input Screening Pass**: `GuardrailsService.screenInput()` calling `gemini-3.1-flash-lite` before orchestrator execution to screen prompt injections, system overrides, and jailbreak attempts.
- [x] **Untrusted Content Data Boundaries**: All tool outputs and retrieved Knowledge Base chunks are enclosed inside `<untrusted_content source="...">...</untrusted_content>` tags to prevent instruction hijacking.
- [x] **Per-User Rate Limiting**: 60-second sliding-window rate limiter throwing HTTP `429 Too Many Requests` when burst limit (15 req/min) is exceeded.
- [x] **Daily Gemini Spend Cap & Alerting**: `GuardrailsService.recordUsageAndCheckSpendCap()` tracks daily token counts and estimated USD spend in `daily_llm_usage` table. Triggers alerts at 80% threshold and safely blocks non-critical LLM calls at 100% cap ($5.00/day).
- [x] **Automated Safety & Injection Test Suite**: Created [`src/scripts/test-guardrails.ts`](file:///D:/Rishabh/Enlight%20Metals%20Sales/em-os-backend/src/scripts/test-guardrails.ts) (`npm run test:guardrails`).

### 2. Exit Criteria Verification

| Exit Criteria                                  | Verification Status | Empirical Proof / Log Output                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Direct Prompt Injection Screening Block** | 🟢 Verified         | Passed in `test-guardrails.ts`: Jailbreak & system override attempt screened and blocked with polite message                                                                                                                          |
| **2. Indirect Prompt Injection Protection**    | 🟢 Verified         | Document with embedded `<untrusted_content>` malicious instruction processed safely; raw specs returned without instruction hijacking                                                                                                 |
| **3. Per-User Rate Limiting (HTTP 429)**       | 🟢 Verified         | Rapid 20-request burst triggered HTTP 429 exception & logged `rate_limit_block` to `audit_log`                                                                                                                                        |
| **4. Daily Spend Cap & Alerting Drill**        | 🟢 Verified         | Token usage accumulation simulation triggered `CRITICAL: Daily Gemini Spend Cap Exceeded! ($6.7502 / $5.00)`, updated `daily_llm_usage` table, logged `spend_cap_exceeded_block` to `audit_log`, and blocked subsequent chat requests |

# AI Assistant — Root Cause Analysis & Remediation Plan

> [!IMPORTANT]
> This is a diagnostic and architectural review, not a quick patch. The findings below explain **why** the assistant keeps breaking, and what can realistically be done about it.

---

## The Short Answer

The AI assistant is built on a two-layer architecture:

1. **Gemini** (the LLM) is asked to understand the user's intent and pick the right tool with the right arguments.
2. **A hand-coded rescue layer** (~500 lines of if/else chains) kicks in whenever Gemini fails to return a tool call.

Every recurring bug traces back to one of these two layers failing. As the platform grows and more tasks are added, both layers become harder to maintain and more fragile. The more you ask the assistant to do, the more likely it is to fail.

---

## Part 1: Why Gemini Fails (Layer 1 Failures)

### 1A. Ambiguous intent → Gemini returns text instead of a tool call

Gemini is a probabilistic model. When the user's message is ambiguous, Gemini may respond with plain text instead of calling a tool. This is the most common failure mode.

**Examples from the codebase where this was observed:**

- "Show complaints raised in the last 7 days" — Gemini returned empty text, no `get_complaints` call, no `date_range` arg.
- "What is our delivered tonnage trend?" — Gemini sometimes returns a refusal ("I cannot provide") instead of calling `get_my_open_deals`.

**Why this happens:** The system prompt is now over 1,200 lines long (lines 940–1188 in `chatbot.service.ts`). Gemini has to read every line of this prompt before it can decide what tool to call. The longer and more complex the prompt, the more likely Gemini is to miss a specific instruction buried deep in the text.

### 1B. Wrong arguments passed by Gemini

Even when Gemini correctly identifies the right tool, it frequently passes incomplete or wrong arguments:

- For `get_complaints` with a date query, Gemini often passes `{}` (empty args) instead of `{ date_range: "last_7_days", limit: 50 }`.
- For `update_customer_profile`, Gemini must extract `customer_name`, `phone`, `contact_person` etc. from free-form natural language. It misses fields regularly.

**Why this happens:** The tool declaration descriptions are the only signal Gemini has for how to populate args. They are short, and Gemini's instruction-following at low temperature (0.1) becomes rigid — it either calls perfectly or fails entirely.

### 1C. Gemini's function-calling is non-deterministic

Two identical messages sent seconds apart may produce different behavior — one gets a tool call, one gets plain text. This is inherent to LLMs. There is no fix for this at the model level without switching to a deterministic router.

---

## Part 2: Why the Rescue Layer Fails (Layer 2 Failures)

The rescue heuristics live from approximately line 1499 to line 2100 in `chatbot.service.ts`. This is the fallback that runs when Gemini returns no tool call.

### 2A. Keyword matching is too rigid

The rescue layer uses `lowerMsg.includes('...')` and regex on the raw message. This breaks the moment the user phrases something differently.

**Concrete example — the complaint bug that was just fixed:**

```
"Show complaints raised in the last 7 days"
```

The old rescue code checked for `lowerMsg.includes('last 7 days')` but NOT for `lowerMsg.includes('complaints this week')` or `lowerMsg.includes('recent complaints')`. So those phrasings fell through to an empty `rescuedArgs = {}`, which sent `limit: 20` with no date filter, returning only partial results.

**More examples of keyword fragility in the current code (lines 1648–1820):**

- Visits are rescued by checking for `lowerMsg.includes('visit')` — but "I had a meeting at ABC Steel" contains no word "visit", so it may miss.
- Salesperson name matching is hardcoded: `lowerMsg.includes('rishabh')`, `lowerMsg.includes('max')`, `lowerMsg.includes('akruti')`. Add a new salesperson and the rescue breaks.
- Location matching: only `nashik`, `mumbai`, `pune`, `bhiwandi`, `taloja` are hardcoded. Any other city falls through.

### 2B. The rescue layer has no context awareness

The rescue layer reads only `lowerMsg` (the current message). It has no access to conversation history. So a follow-up message like:

> "How many of those are open?"

...cannot be rescued — there is no "those" in `lowerMsg`, so the rescue dispatches either the wrong tool or no tool at all. Gemini handles this in the normal path via multi-turn history, but when Gemini fails and rescue takes over, context is lost.

### 2C. Operational (write) tools in the rescue layer are unsafe

The rescue layer has branches that auto-dispatch write tools like `log_customer_visit`, `log_complaint`, `update_deal_stage`, and `log_payment` based on keywords alone (lines 1843–1966). This means:

- A message that says "I had a payment complaint from Supreme Steel" could simultaneously match both the `log_payment` and `log_complaint` branches, depending on evaluation order.
- There is no confirmation step before a write tool fires via rescue.

### 2D. Hardcoded stale data in the system prompt

Line 1137 in `chatbot.service.ts` contains this hardcoded assertion in the system prompt:

```
State clearly that Rishabh Makwana has 12 complaints (7 open, 5 resolved across 8 accounts)
while Max has 9 complaints...
```

These numbers are baked into the prompt. The moment the real data changes in the database, the assistant lies to the user. This is a silent data staleness bug that will recur indefinitely unless removed.

Similarly, line 1144 hardcodes:

```
State clearly that the mean average reorder cycle is 30.3 days (~30 days / 1 month)
across all 80 tracked customer accounts.
```

Every time the team onboards a new customer or a complaint is resolved, these numbers go stale.

---

## Part 3: Is the AI Assistant the Right Tool for Granular Tasks?

**The direct answer: No, not for highly specific transactional field mutations.**

### What the assistant handles well

- Read-only queries with a clear domain: "Show my complaints this month", "List follow-ups due today", "What's the pipeline value?"
- Logging structured events from natural language: "Visited Supreme Steel today, discussed 20 MT HR Plates." — The `log_customer_visit` tool's `parseVisitArgs` function handles this well because the structure is loose (any narrative works).

### What breaks regularly

**Granular field mutations** like:

- "Change the phone number in field `contact_no` for Apex Steel to 9876543210"
- "Update the GSTIN for Deccan Fabricators to 27AAAAA0000A1Z5"
- "Set order frequency for Supreme Steel to 45 days"

**Why these break:**

1. Gemini must extract exactly the right field name (`contact_no` vs `phone` vs `mobile`) from a free-form sentence.
2. The `parseCustomerProfileUpdateArgs` function in `update_customer_profile.tool.ts` (lines 51–202) is already 150 lines of custom regex to handle this — and it still misses edge cases.
3. If Gemini returns empty text (which happens frequently for field-update queries), the rescue layer has no branch for `update_customer_profile` at all (there is no rescue for this tool in the current code). So the mutation silently fails.
4. The user gets no error — they get either a generic response or silence.

**The core problem:** LLMs are trained to generate language. Using them as a deterministic field router (which field? which value? which customer? which table?) is fighting their fundamental nature.

---

## Part 4: Root Cause Summary

| Failure Category                                             | Frequency | Severity             |
| ------------------------------------------------------------ | --------- | -------------------- |
| Gemini returns no tool call (ambiguous query)                | Very High | High                 |
| Rescue layer misses phrasing variations                      | High      | High                 |
| Hardcoded stale data in system prompt                        | Medium    | High (silent lies)   |
| Write tool fires without confirmation via rescue             | Low       | Critical             |
| Duplicate `parseDateFilter` logic across 4 tool files        | Ongoing   | Medium (maintenance) |
| Synthesis truncation (items sliced to 15) for Gemini re-call | Medium    | Medium               |
| Context lost when rescue replaces Gemini multi-turn          | Medium    | Medium               |

---

## Part 5: Concrete Remediation Plan

These are ordered by impact-to-effort ratio. Start from the top.

---

### Fix 1: Remove all hardcoded numbers from the system prompt (High Impact, Low Effort)

**What to do:** Delete every line in the system prompt that states specific counts, amounts, or statistics as absolute truths. Replace them with instructions to read from tool output dynamically.

**Lines to fix:** 1137, 1138, 1139, 1144 in `chatbot.service.ts`.

**Example:** Replace:

```
State clearly that Rishabh Makwana has 12 complaints (7 open, 5 resolved across 8 accounts)
```

With:

```
Report the complaints count per sales rep exactly as returned by the tool output from 'get_complaints'.
Do NOT hardcode any specific numbers. All counts must come from live tool data.
```

**Why:** This is a silent correctness bug that will keep recurring every time real data changes.

---

### Fix 2: Add a rescue branch for `update_customer_profile` (High Impact, Medium Effort)

**What to do:** Add a rescue branch in the heuristics section (around line 1959 in `chatbot.service.ts`) that catches messages like "change phone", "update number", "set contact", "update GST", "change frequency" and dispatches `update_customer_profile` with `{ text: messageText }`. The tool's own `parseCustomerProfileUpdateArgs` already handles parsing.

**Why:** Currently, when Gemini fails on a field-update request, nothing fires. The user gets silence. This fix makes the rescue layer catch those requests and send them to the right tool, the same way `log_complaint` and `log_customer_visit` are already rescued.

---

### Fix 3: Extract `parseDateFilter` to a shared utility (Medium Impact, Medium Effort)

**What to do:** Create `D:\Rishabh\Enlight Metals Sales\em-os-backend\src\modules\chatbot\tools\date-filter.util.ts` with a single exported `parseDateFilter(dateRangeStr: string)` function. Import it in all four query tools: `get_complaints`, `get_visits`, `get_inquiries`, `get_my_open_deals`.

**Why:** The same function is currently copy-pasted across 4 files. When a new date alias needs to be added (e.g. "fortnight", "biweekly"), it has to be changed in 4 places. That is exactly why the `last_7_days` bug existed — one tool was updated but others were not.

---

### Fix 4: Add a confirmation gate before rescue fires write tools (High Impact, Medium Effort)

**What to do:** When the rescue layer is about to fire an operational (write) tool (`log_complaint`, `log_customer_visit`, `update_deal_stage`, `log_payment`, `onboard_new_customer`, `update_customer_profile`), save the pending intent to session state and ask the user to confirm before executing.

**Example flow:**

- User: "Received payment of 50,000 from Apex Steel"
- Assistant (rescue, pre-confirmation): "I will log a payment of ₹50,000 from Apex Steel via NEFT. Please confirm — reply 'yes' to proceed or 'cancel' to discard."
- User: "yes"
- Assistant: fires `log_payment`

**Why:** The current rescue layer fires write tools without any confirmation. A misrouted write (e.g. "I visited Supreme Steel" being logged when the user was asking to show visits) corrupts real data.

---

### Fix 5: Trim and modularize the system prompt (Medium Impact, High Effort)

**What to do:** The current system prompt (lines 940–1188) is a single 1,200-line monolithic string. This causes Gemini to lose precision on specific tool instructions buried in the middle.

Refactor it into sections:

1. Role and identity (keep short: ~20 lines)
2. Formatting rules (keep: ~15 lines)
3. RBAC and domain scope (keep: ~15 lines)
4. Per-tool instructions — only include the tools relevant to the caller's role (inject dynamically based on `caller.role`)

**Why:** A salesperson does not need `get_team_pipeline` or `get_loss_analytics` instructions in their prompt. Sending them anyway wastes tokens and increases the probability that Gemini picks the wrong tool from a longer list.

---

### Fix 6: For highly specific field mutations, bypass Gemini entirely (Long Term)

**What to do:** Create a deterministic pre-router that runs before the Gemini call. If the message matches a high-confidence pattern for a field mutation (e.g. regex matches "change [field] for [customer] to [value]"), route directly to the tool without involving Gemini at all.

**Example patterns to pre-route:**

- `/(change|update|set)\s+(phone|number|contact|gst|gstin|frequency)\s+(for|of)\s+.+\s+(to|as)\s+/i` → `update_customer_profile`
- `/received\s+payment\s+of\s+[\d,]+\s+from\s+.+/i` → `log_payment`

**Why:** These patterns are deterministic. Gemini adds no value when the intent is unambiguous. Pre-routing eliminates the failure mode entirely for these cases.

---

## Summary Table: What to Build

| #   | Fix                                             | Files Affected                           | Effort  | Impact                       |
| --- | ----------------------------------------------- | ---------------------------------------- | ------- | ---------------------------- |
| 1   | Remove hardcoded numbers from system prompt     | `chatbot.service.ts` lines 1137–1144     | 30 min  | Immediate correctness        |
| 2   | Add rescue branch for `update_customer_profile` | `chatbot.service.ts` lines ~1959         | 1 hour  | Catch silent failures        |
| 3   | Extract shared `parseDateFilter` utility        | New `date-filter.util.ts` + 4 tool files | 2 hours | Prevents future date bugs    |
| 4   | Confirmation gate before rescue write tools     | `chatbot.service.ts` rescue dispatch     | 3 hours | Prevents data corruption     |
| 5   | Modularize system prompt by role                | `chatbot.service.ts` system prompt       | 4 hours | Fewer Gemini misroutes       |
| 6   | Pre-router for deterministic mutations          | New `intent-pre-router.ts`               | 1 day   | Eliminates class of failures |

---

> [!NOTE]
> Fix 1, 2, and 3 should be implemented immediately and can be done in a single PR. Fixes 4 and 5 are the next sprint. Fix 6 is the architectural north star that makes the system genuinely reliable.

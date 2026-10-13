# Backend regression tests

One test file per fixed bug. CI runs them with the rest of `npm run test:ci`; run just these with `npm run test:regression`.

- Name: `issue-<number>-<short-slug>.test.ts`, with the GitHub issue link on the first line.
- Write the test first and watch it fail against the unfixed code, then fix.
- Stay offline: build services with `createSupabaseMock` / `asSupabaseService` from `src/test-utils/supabase.mock.ts`; mock Prisma and LLM clients with `jest.fn()`. Network access throws.
- Assert the API contract (returned rows, scoping by role/salesperson, status codes), not private helpers.
- Do not delete or weaken a regression test to make CI pass.

This folder is excluded from `dist` (`.swcrc`, `tsconfig.build.json`). Files without an issue number predate this convention; replace their `Issue:` placeholder with the real link.

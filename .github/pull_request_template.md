## What and why
<!-- Link the issue: Fixes #123 -->

## Regression test (required for bug fixes)
- [ ] Added `src/__regression__/issue-<n>-<slug>.test.ts` that fails without this fix and passes with it
- Test file: <!-- path, or "N/A – not a bug fix" with reason -->

## Checklist
- [ ] `npm run lint`, `npm run build`, `npm run test:ci` pass locally (offline, no `.env`)
- [ ] Role guards and salesperson scope enforced server-side
- [ ] Pricing/HSN changes mirrored in bot + frontend and all three `pricing-parity.json` copies
- [ ] No secrets, tokens, OTPs, or full phone numbers in logs/tests
- [ ] `em-os-frontend/knowledge` updated if an API, table, or workflow changed

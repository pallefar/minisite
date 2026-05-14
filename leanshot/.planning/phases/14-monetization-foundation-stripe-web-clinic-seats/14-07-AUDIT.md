## Trigger source: invoice.upcoming webhook

Sub-task A audit (Open Question 1):

- `vercel.json` has no `crons` array — verified via `jq '.crons // "no crons configured"'`.
- 14-03's dispatcher already routes `invoice.upcoming` events. No evidence of reliability issues in Stripe test mode.
- Decision: proceed with `invoice.upcoming` webhook handler (default per RESEARCH Open Question 1).

## SDK path: stripe.billing.meterEvents.create

Sub-task B audit (Assumption A10):

- Ran `deno eval` against `https://esm.sh/stripe@19?target=denonext` with `apiVersion: '2026-04-22.dahlia'`.
- Result: `s?.v1?.billing?.meterEvents?.create` → `undefined`
- Result: `s?.billing?.meterEvents?.create` → `function`
- Decision: use `stripe.billing.meterEvents.create(...)` (v1 namespace absent at runtime).
- Hardcoded (no runtime conditional) in `invoice-upcoming.ts`.

# Stripe Mode Switchover Runbook (TEST → LIVE)

**Created:** 2026-05-27 during Plan 70-01 S06+S08-S10
**Phase:** 70 — Consolidated UAT — v1.4 Launch Gate
**Pattern:** Minimal switch — secrets ARE the switch (no code-level mode dispatch)

## State at end of Plan 70-01 (TEST mode)

| Secret name | TEST value | _LIVE placeholder | Notes |
|-------------|-----------|-------------------|-------|
| `STRIPE_MODE` | `test` | n/a | Mode indicator (informational; no code consumes this yet) |
| `STRIPE_PRICE_LIFETIME` | `price_0Tbj1G1xTnHBqsUWKgtlE8FW` (TEST $499) | `STRIPE_PRICE_LIFETIME_LIVE=PENDING_LIVE_FLIP_70_01_S06` | Consumed by `stripe-checkout` Fn |
| `STRIPE_COUPON_WINBACK_10` | `WINBACK_10` (TEST 10% once) | `STRIPE_COUPON_WINBACK_10_LIVE=PENDING_LIVE_FLIP_70_01_S08` | Consumed by `lifecycle-win-back` Fn (t30d cadence) |
| `STRIPE_COUPON_WINBACK_25` | `WINBACK_25` (TEST 25% once) | `STRIPE_COUPON_WINBACK_25_LIVE=PENDING_LIVE_FLIP_70_01_S09` | Consumed by `lifecycle-win-back` Fn (t60d cadence) |
| `STRIPE_COUPON_WINBACK_50` | `WINBACK_50` (TEST 50% once) | `STRIPE_COUPON_WINBACK_50_LIVE=PENDING_LIVE_FLIP_70_01_S10` | Consumed by `lifecycle-win-back` Fn (t90d cadence) |

**`stripe_price_lookup` table:**
- `('lifetime', 'price_0Tbj1G1xTnHBqsUWKgtlE8FW')` — TEST mode

**Existing `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`:** mode unknown (pre-Phase-70). If TEST, leave as-is. If LIVE, rotate at switchover (see step 4 below).

## Live-flip checklist

Run these steps in order. Each step is operator-driven; no autonomous mode-flip.

### Pre-flight
- [ ] All Plan 70-01 critical signals signed off
- [ ] Plan 70-02 (stripe-test) signoffs green — verifies tax, dunning, refund flows in TEST mode
- [ ] Plan 70-07 regression-watch window started (48h before launch)

### Step 1 — Provision LIVE Stripe objects

Either via Dashboard (browser) or CLI with `sk_live_*` (bootstrap-revoke per `reference_stripe_cli_rk_live_scope_limitation`):

```bash
# Get sk_live_ from Stripe Dashboard → Developers → API keys → Reveal live key
echo "sk_live_..." > /tmp/stripe-live-key.txt
chmod 600 /tmp/stripe-live-key.txt
STRIPE_API_KEY=$(cat /tmp/stripe-live-key.txt)

# Create live-mode Lifetime product + price
PROD_LIVE=$(stripe products create --api-key="$STRIPE_API_KEY" --name="LeanShot Lifetime" --description="One-time. Lifetime access." -d 'metadata[plan]=lifetime' -d 'metadata[milestone]=v1.4' | jq -r .id)
PRICE_LIVE=$(stripe prices create --api-key="$STRIPE_API_KEY" --product="$PROD_LIVE" --unit-amount=49900 --currency=usd -d 'metadata[plan]=lifetime' | jq -r .id)
echo "LIVE price: $PRICE_LIVE"

# Create live-mode WINBACK coupons (3)
stripe coupons create --api-key="$STRIPE_API_KEY" --id="WINBACK_10" --percent-off=10 --duration=once --name="Win-back 10% off (t30d cadence)" -d 'metadata[cadence]=t30d'
stripe coupons create --api-key="$STRIPE_API_KEY" --id="WINBACK_25" --percent-off=25 --duration=once --name="Win-back 25% off (t60d cadence)" -d 'metadata[cadence]=t60d'
stripe coupons create --api-key="$STRIPE_API_KEY" --id="WINBACK_50" --percent-off=50 --duration=once --name="Win-back 50% off (t90d cadence)" -d 'metadata[cadence]=t90d'

rm /tmp/stripe-live-key.txt
# Rotate sk_live_ in Stripe Dashboard after this step.
```

### Step 2 — Flip Supabase secrets

```bash
npx supabase secrets set --project-ref ytnsipxxmzgaebkqmokp \
  STRIPE_PRICE_LIFETIME="<live-price-id-from-step-1>" \
  STRIPE_PRICE_LIFETIME_LIVE="<live-price-id-from-step-1>" \
  STRIPE_COUPON_WINBACK_10=WINBACK_10 \
  STRIPE_COUPON_WINBACK_10_LIVE=WINBACK_10 \
  STRIPE_COUPON_WINBACK_25=WINBACK_25 \
  STRIPE_COUPON_WINBACK_25_LIVE=WINBACK_25 \
  STRIPE_COUPON_WINBACK_50=WINBACK_50 \
  STRIPE_COUPON_WINBACK_50_LIVE=WINBACK_50 \
  STRIPE_MODE=live
```

### Step 3 — Update `stripe_price_lookup`

```bash
npx supabase db query --linked "UPDATE public.stripe_price_lookup SET stripe_price_id='<live-price-id>', updated_at=now() WHERE plan_name='lifetime';"
```

### Step 4 — Rotate `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` if currently TEST

If currently TEST (probe by hitting a real Stripe call from any Edge Fn and inspecting the API response mode):
- Capture LIVE `sk_live_*` from Dashboard
- Configure LIVE webhook endpoint at `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/stripe-webhook`
- Capture LIVE webhook signing secret
- `supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...`

### Step 5 — Re-deploy Edge Fns (no-op if no code changed)

```bash
npx supabase functions deploy stripe-checkout --project-ref ytnsipxxmzgaebkqmokp
npx supabase functions deploy lifecycle-win-back --project-ref ytnsipxxmzgaebkqmokp
# (other Stripe-touching Fns as needed)
```

### Step 6 — Smoke

- [ ] Live checkout: hit `/functions/v1/stripe-checkout` with a real Stripe LIVE test user → receive a live Stripe Checkout URL
- [ ] Inspect Checkout in Stripe Dashboard LIVE mode (NOT test mode) — confirm Lifetime price shows as $499
- [ ] Webhook smoke: trigger a low-value live charge (e.g. $1 promo) → verify `stripe-webhook` processes the event + writes to subscriptions

### Step 7 — Plan 70-08 final-signoff

Reference this runbook from Plan 70-08 S04 (ship rule application) — the LIVE flip MUST happen BEFORE git tag `v1.4.0-ship`.

## Rollback

If anything fails at Steps 4-6, roll back by reversing Step 2:
```bash
npx supabase secrets set STRIPE_PRICE_LIFETIME=price_0Tbj1G1xTnHBqsUWKgtlE8FW STRIPE_MODE=test ...
```
Edge Fns will return to TEST behavior. Document the failure mode in a new GH issue tagged `v1.4-launch-deferral`.

## Why this works (architectural note)

The "switch in the app" is intentionally minimal — there's no `_TEST`/`_LIVE` dispatch in Edge Fn code. Reasons:

1. **Smaller blast radius** — flipping the canonical secret names (`STRIPE_PRICE_LIFETIME`, etc.) is reversible per-key. A code-level switch would require coordinated deploy + secret update.
2. **The `_LIVE` placeholder secrets are documentation slots** — they exist so anyone running `supabase secrets list` sees that LIVE values are EXPECTED (not just missing).
3. **`STRIPE_MODE` is informational** — it surfaces current mode for observability/logging. If we ever DO need conditional code paths, the slot is reserved.

Refines [[reference_stripe_cli_rk_live_scope_limitation]].

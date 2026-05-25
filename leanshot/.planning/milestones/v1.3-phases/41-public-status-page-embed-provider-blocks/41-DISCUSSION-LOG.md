# Phase 41 — Discussion Log

**Date:** 2026-05-19
**Phase:** 41 — Public Status Page + Embed-Provider Blocks
**Mode:** discuss (default; batched)

---

## Gray-area selection

ALL 4 — Better Stack status-page scope · Cookie-consent gating · CSP allowlist policy · Custom-iframe security

---

## Area 1: Better Stack status-page (Workstream A — POLISH-10)

- Component shape → **Hybrid 7-component (4 user-facing + 3 underlying-service, hierarchical)** → D-01
- Auto-incident thresholds → **Conservative (Sentry >5%/5min; Vercel deploy fail; Supabase >1s p95/10min)** → D-02
- Subscriber + maintenance → **Email-only via Better Stack form; maintenance scheduled in Better Stack UI** → D-03 + D-04

D-05: DNS CNAME status.leanshot.app → Better Stack.
D-06: Founder HUMAN-UAT for Better Stack tier upgrade + integration setup + CNAME.

---

## Area 2: Cookie-consent gating (Workstream B — EMBED-04/05)

- Per-embed category → **Fixed per-provider mapping** → D-07
  - Calendly = functional + analytics
  - YouTube = analytics + marketing
  - Tally = functional
  - Custom-iframe = marketing default
- Decline fallback → **Branded placeholder card with provider logo + Enable-cookies link** → D-08
- Re-consent UX → **Auto-load on consent grant via window event listener** → D-09

D-10: DS Skeleton + opacity 0→1 over 200ms gated by useReducedMotion (Phase 15 pattern).

---

## Area 3: CSP allowlist policy (Workstream B — EMBED-04)

- Enforcement posture → **Enforce day-1 + Sentry reporting endpoint for ongoing visibility** → D-11
- Provider host entries → **Conservative (only docs-required hosts; no wildcards beyond known *.calendly.com)** → D-12
- Custom-iframe allowlist admin → **Superadmin-only at /admin/embeds/allowlist + audit-logged** → D-17

D-13: monthly CSP-violation review by founder/ops.
D-14: dynamic CSP frame-src injection per Custom-iframe allowlist table.

---

## Area 4: Custom-iframe security (Workstream B — EMBED-07)

- URL validation → **Hostname-exact match (no subdomain wildcards)** → D-15
- Sandbox flags policy → **Fixed minimum globally (allow-scripts + allow-same-origin); per-provider hardcoded** → D-16
- Phase 12 ad-free interaction → **Custom-iframe blocks ARE ad-eligible (live outside ad-free firewall)** → D-18

---

## Claude's Discretion captured

- Calendly inline preview in PageEditor via popup OAuth (V13-EMBED pitfall avoidance)
- CSP snapshot test extension (Phase 12 D-10 pattern)
- New embed block types registered in Phase 15 schema
- dompurify config for admin-pasted HTML (Phase 50 chain reuse)
- iframe loading="lazy" attribute always
- Better Stack integration shape (Sentry-OAuth + Vercel deploy-hook + Supabase heartbeat)

## Out-of-scope items raised

- In-app status dashboard (Better Stack standalone in v1.3)
- RSS/Slack subscriber channels (email-only)
- Per-org custom-iframe allowlist (superadmin-only at deployment scope)
- Admin-overridable iframe sandbox flags (locked-down in v1.3)
- Stripped-down no-cookie preview proxies (branded placeholder is the fallback)
- Maintenance scheduling UI in-app (Better Stack UI direct)
- Embed analytics (PostHog per-block-view in v1.4)

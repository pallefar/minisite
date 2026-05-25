---
phase: 57
slug: watch-apps-apple-watch-wear-os
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-25
---

# Phase 57 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS sync-contract + complication/tile data logic); static config checks (native scaffolds) |
| **Config file** | `leanshot/vite.config.ts` (vitest projects-config masks default `test:` — use `npx vitest run --config vite.config.ts`) |
| **Quick run command** | `npx vitest run --config vite.config.ts src/lib/watch/` |
| **Full suite command** | `npx vitest run --config vite.config.ts` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick command (`npx vitest run --config vite.config.ts src/lib/watch/`)
- **After every plan wave:** Run full suite
- **Before verify:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (planner populates) | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] vitest already configured in `leanshot/vite.config.ts` — existing infrastructure covers TS surface
- [ ] Native scaffold validation via `xcodebuild -list` (iOS) + Gradle `--dry-run` (Android) — no device needed

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| On-device complication/tile render, watch push delivery, real WatchConnectivity/Data-Layer sync | WATCH-01..07 | Requires physical Apple Watch / Wear device + Apple Dev / Play accounts | Defer to Phase 70 consolidated UAT |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

# Phase 22 Deferred Items (out-of-scope discoveries)

Items logged here are **pre-existing or sibling-plan ownership** — out of scope for the plan that found them. They MUST be addressed by the owning plan or by a phase-close sweep.

## From Plan 22-11 execution (2026-05-16)

| Item | File(s) | Owner | Notes |
|------|---------|-------|-------|
| 4 Wave-0 scaffold test files fail to load (missing component imports) | `src/components/impersonation/__tests__/ImpersonationBanner.test.tsx`, `src/components/impersonation/__tests__/useImpersonationReadOnly.test.ts`, `src/components/soft-delete/__tests__/SoftDeleteCountdownBanner.test.tsx`, `src/components/admin/members/__tests__/RefundModal.test.tsx` | Sibling Wave-1/Wave-2 plans (ADMIN-03 impersonation, DEL-01 soft-delete, ADMIN-04 refund) | These scaffolds reference `@/components/impersonation/ImpersonationBanner` + `@/hooks/useImpersonationReadOnly` + `@/components/soft-delete/SoftDeleteCountdownBanner` + `@/components/admin/members/RefundModal` which aren't on the 22-11 base merge `5e97df3`. Failure mode is "Failed to resolve import" at vite transform time, so the file never executes any `it.skip` body. Will resolve when sibling Wave-1/2 plans merge their owning implementations into main. Plan 22-11's own 33 tests (5 new files) all pass. |

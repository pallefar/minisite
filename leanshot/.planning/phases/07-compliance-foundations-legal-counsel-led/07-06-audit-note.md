# 07-06 Whitelist Audit (Step 1 of Task 1)

Confirms the pre-extension hygiene of `src/components/dashboard/settings/SettingsPage.tsx:162-190` (`exportData()`) before extending. This closes Threat T-07-06-02 (info disclosure via raw localStorage) prior to widening.

## Findings

1. **(a) Existing code IS already an explicit whitelist.** `exportData()` enumerates **17 keys** by name (`user`, `injections`, `symptoms`, `weights`, `measurements`, `meals`, `water`, `foodNoise`, `workouts`, `steps`, `supplements`, `mood`, `sleep`, `nsvs`, `photos`, `vials`, `costs`). It calls `JSON.stringify(data, ...)` on the constructed `data` object — NEVER `JSON.stringify(localStorage)`. No `Object.keys` / `Object.entries` / `Object.assign` pass-through. ✅
2. **(b) The supabase session lives under `sb-leanshot-auth-token` in localStorage** (managed by `supabase-js`'s `persistSession`). The existing `exportData()` does NOT touch `localStorage` directly and does NOT include this key in its whitelist. The Zustand persistence layer (`leanshot_v4` namespaced) is also distinct from the supabase auth namespace, so even the Zustand-derived state does not contain the session token. ✅
3. **(c) No anthropic key serialized.** Phase 4 D-03 retired the BYO-key flow entirely; `apiKeyStorage` was removed (`src/lib/storage.ts:42-45` comment confirms). A one-shot cleanup in `main.tsx` wipes any stale `leanshot_anthropic_key` value on next boot. The existing `exportData()` does not reference it. ✅

## Disposition

All three preconditions hold → safe to extend the whitelist (not replace it with raw-localStorage). The new `buildJsonExport` in `src/lib/export-data.ts` MUST preserve the explicit-enumeration discipline and add only the 5 missing partialize keys (`aiHistory`, `acknowledgedDisclaimer`, `pendingOps`, `verificationBannerDismissedUntil`, `migration_state`) to reach the full 22-key allow-list.

Test 2 in `src/test/export-data.test.ts` is the regression test: passes a rogue `sb_leanshot_auth_token`-shaped key and asserts it does NOT appear in the output.

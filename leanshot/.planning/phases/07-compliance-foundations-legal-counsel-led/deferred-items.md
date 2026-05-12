- **07-04 noted (not owned):** Sibling plan 07-06 has a pending typecheck error in `src/lib/export-data.ts:525` — `Conversion of type 'Photo[]' to type 'Record<string, unknown>[]'` index-signature mismatch. Pre-existing as of 07-04 execution; 07-06 owns the fix (Batch 2 sibling still in flight). Not blocking for 07-04's legal-pages surface (only touches 07-06's new file).

## From 07-07 execution (out-of-scope discoveries)

- **Pre-existing lint errors in src/components/legal/ConsumerHealthData.tsx** (10 errors: 1 import-x/order + 9 react/no-unescaped-entities). Introduced by Plan 07-03 commit 5c29dc2. Out of scope for 07-07 (account-delete plan). Suggested fix: `npm run lint:fix` for the import-x reorder + manually escape `"` → `&quot;` and `'` → `&apos;` in the JSX strings on lines 110, 132, 164, 173, 245.

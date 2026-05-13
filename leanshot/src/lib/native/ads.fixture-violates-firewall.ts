// DO NOT MERGE. This file lives on branch firewall-test-violation only.
// It proves the Two-tunnel firewall ESLint rule (Phase 12 D-03) trips
// when health.ts is imported from the ad transport directory.
//
// To verify: run `npm run lint` on this branch — it must exit non-zero with
// an import-x/no-restricted-paths error on the line below.

// INTENTIONAL VIOLATION DO NOT COPY — must NOT be silenced with eslint-disable
import type { HealthSample } from './health';

export const _fixtureViolation: HealthSample | null = null;

/**
 * Phase 25 Plan 25-09 — ComplianceModule root.
 * HIPAA-12 + HIPAA-13: Composes the three compliance surfaces:
 *   1. ExpiryBanner — red/orange/amber alert if any vendor BAA near expiry.
 *   2. BaaChainTable — 6-vendor BAA status table with edit-status modal.
 *   3. SubprocessorDiffFeed — chronological subprocessor change log.
 *
 * AdminLayout already gates at minRole='superadmin' (Pattern S1 first layer).
 * RPC layer enforces superadmin re-check (Pattern S1 second layer).
 */
import { BaaChainTable } from './BaaChainTable';
import { ExpiryBanner } from './ExpiryBanner';
import { SubprocessorDiffFeed } from './SubprocessorDiffFeed';

export function ComplianceModule() {
  return (
    <div className="space-y-6">
      <ExpiryBanner />
      <BaaChainTable />
      <SubprocessorDiffFeed />
    </div>
  );
}

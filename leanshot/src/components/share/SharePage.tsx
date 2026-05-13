/**
 * Phase 8 Plan 08-04 Task 1 placeholder — SharePage lazy chunk entry point.
 *
 * Task 2a (this plan) replaces this body with the full state machine
 * (loading | needs-code | rendering | revoked | expired | error) plus 5s
 * polling per HI-4 and chart/report rendering. This minimal version exists
 * so App.tsx's lazy import typechecks at the end of Task 1.
 */

import { useEffect, useState } from 'react';
import { CodeEntryScreen } from './CodeEntryScreen';
import { ShareRevokedScreen } from './ShareRevokedScreen';
import { fetchSnapshot } from './share-client';

interface Props {
  token: string;
}

export function SharePage({ token }: Props) {
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    void fetchSnapshot(token).then((r) => {
      if (!r.ok && (r.error === 'requires-code' || r.error === 'invalid-session')) {
        setShowCode(true);
      }
    });
  }, [token]);

  if (showCode) return <CodeEntryScreen token={token} onSuccess={() => setShowCode(false)} />;
  return <ShareRevokedScreen kind="load-error" />;
}

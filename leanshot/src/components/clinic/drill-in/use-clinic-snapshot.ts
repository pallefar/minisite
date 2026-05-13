/**
 * Phase 10 Plan 10-07 — useClinicSnapshot hook.
 *
 * Fetches patient snapshot data from the clinic-snapshot Edge Function (Plan 10-04).
 * Handles 401/403/500 error states which ClinicDrillInPage translates into UX actions:
 *   - 401: patient revoked membership → toast + redirect to roster
 *   - 403: consent_scope changed → toast + unmount blocked section
 *   - 500: network/server error → inline retry
 *
 * Security: JWT is attached as Authorization: Bearer header. Cache-Control: private, no-store
 * is enforced server-side (Plan 10-04 T-10-04-03 mitigation). Client does not cache.
 *
 * Threat model: T-10-07-04 (401 loop) is mitigated in ClinicDrillInPage: one-shot
 * setTimeout redirect means subsequent 401s during the same drill-in session are ignored.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { SnapshotData } from '@/types/snapshot';

export interface ClinicSnapshotError {
  status: 401 | 403 | 500;
  /** Present on 403: the section key that the patient has removed from consent_scope. */
  blockedSection?: string;
  message?: string;
}

export interface UseClinicSnapshotResult {
  snapshot: SnapshotData | null;
  loading: boolean;
  error: ClinicSnapshotError | null;
  refresh: () => void;
  lastFetchedAt: Date | null;
}

export function useClinicSnapshot(opts: {
  orgId: string | null;
  patientId: string | null;
}): UseClinicSnapshotResult {
  const { orgId, patientId } = opts;
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ClinicSnapshotError | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  // Fetch counter drives the refresh() → useEffect re-run cycle.
  const [fetchTick, setFetchTick] = useState<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSnapshot = useCallback(async () => {
    if (!orgId || !patientId) return;

    // Abort any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const jwt = sessionData?.session?.access_token;

      if (!jwt) {
        setError({ status: 401, message: 'No active session.' });
        setLoading(false);
        return;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const baseUrl = supabaseUrl && supabaseUrl.length > 0 ? supabaseUrl : 'https://placeholder.invalid';

      const url = `${baseUrl}/functions/v1/clinic-snapshot?org_id=${encodeURIComponent(orgId)}&patient_id=${encodeURIComponent(patientId)}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (response.status === 401) {
        let blockedSection: string | undefined;
        try {
          const body = (await response.json()) as { blocked_section?: string };
          blockedSection = body?.blocked_section;
        } catch {
          // ignore parse error
        }
        setError({ status: 401, blockedSection });
        setLoading(false);
        return;
      }

      if (response.status === 403) {
        let blockedSection: string | undefined;
        try {
          const body = (await response.json()) as { blocked_section?: string };
          blockedSection = body?.blocked_section;
        } catch {
          // ignore parse error
        }
        setError({ status: 403, blockedSection });
        setLoading(false);
        return;
      }

      if (!response.ok) {
        setError({ status: 500, message: `HTTP ${response.status}` });
        setLoading(false);
        return;
      }

      const data = (await response.json()) as SnapshotData;
      setSnapshot(data);
      setLastFetchedAt(new Date());
      setLoading(false);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Request was deliberately aborted (e.g. refresh triggered) — do not set error.
        return;
      }
      setError({ status: 500, message: 'Network error.' });
      setLoading(false);
    }
  }, [orgId, patientId]);

  // Re-run on mount and every time refresh() is called (fetchTick changes).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void fetchSnapshot();
    return () => {
      abortRef.current?.abort();
    };
  }, [fetchSnapshot, fetchTick]);

  const refresh = useCallback(() => {
    setFetchTick((t) => t + 1);
  }, []);

  return { snapshot, loading, error, refresh, lastFetchedAt };
}

/**
 * Phase 61 Plan 07 — Hook returning the active patient_protocol_assignment
 * + computed current week + matching ProtocolStep.
 *
 * Per RESEARCH.md Open Question 3: week computation lives in the browser
 * (simple arithmetic from started_at, no server round-trip required).
 *
 * Security: queries with eq('patient_id', patientId); Supabase RLS
 * auth.uid()=patient_id backstops the query (T-61-07-03).
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ProtocolStep, PatientProtocolAssignment } from '@/types/protocols';

export interface ActiveAssignment {
  assignment: PatientProtocolAssignment;
  protocol: { id: string; version: number; name: string; compound: string };
  /** 1-based week number from assignment.started_at to now */
  currentWeek: number;
  /** Step matching currentWeek, or the last available step if past protocol duration */
  currentStep: ProtocolStep | null;
  allSteps: ProtocolStep[];
}

export function useActiveProtocolAssignment(patientId: string | null): {
  data: ActiveAssignment | null;
  loading: boolean;
} {
  const [data, setData] = useState<ActiveAssignment | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!patientId) {
      setData(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      // 1. Find most recent assignment for this patient
      const { data: assignmentRows } = await supabase
        .from('patient_protocol_assignment')
        .select('*')
        .eq('patient_id', patientId)
        .order('started_at', { ascending: false })
        .limit(1);

      if (cancelled) return;

      const assignment = assignmentRows?.[0] as PatientProtocolAssignment | undefined;
      if (!assignment) {
        setData(null);
        setLoading(false);
        return;
      }

      // 2. Fetch protocol metadata (name + compound)
      const { data: protocol } = await supabase
        .from('protocols')
        .select('id, version, name, compound')
        .eq('id', assignment.protocol_id)
        .eq('version', assignment.version)
        .single();

      // 3. Fetch all steps for this protocol version
      const { data: steps } = await supabase
        .from('protocol_steps')
        .select('*')
        .eq('protocol_id', assignment.protocol_id)
        .eq('protocol_version', assignment.version)
        .order('week');

      if (cancelled || !protocol || !steps) {
        setData(null);
        setLoading(false);
        return;
      }

      // 4. Compute current week (1-based) from started_at to now
      const startedMs = new Date(assignment.started_at).getTime();
      const weeksElapsed =
        Math.floor((Date.now() - startedMs) / (7 * 24 * 60 * 60 * 1000)) + 1;

      // Find exact match for current week, or fall back to the last step <= currentWeek
      const allSteps = steps as ProtocolStep[];
      const exactStep = allSteps.find((s) => s.week === weeksElapsed) ?? null;
      const currentStep =
        exactStep ??
        allSteps.reduce<ProtocolStep | null>(
          (best, s) =>
            s.week <= weeksElapsed && (!best || s.week > best.week) ? s : best,
          null,
        );

      setData({
        assignment,
        protocol: {
          id: protocol.id as string,
          version: protocol.version as number,
          name: protocol.name as string,
          compound: protocol.compound as string,
        },
        currentWeek: weeksElapsed,
        currentStep,
        allSteps,
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [patientId]);

  return { data, loading };
}

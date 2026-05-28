/**
 * Phase 10 Plan 10-10 — useRosterSelection hook.
 *
 * Manages multi-select state for the roster. Selection persists across
 * sort + pagination via sessionStorage (key: `clinic_roster_selection_{orgId}`).
 *
 * D-23: checkbox per row, header "X selected" pill, selection persists across
 * column resort and pagination.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY_PREFIX = 'clinic_roster_selection_';

function readFromStorage(orgId: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_PREFIX + orgId);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function writeToStorage(orgId: string, selection: Set<string>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY_PREFIX + orgId, JSON.stringify([...selection]));
  } catch {
    // sessionStorage unavailable
  }
}

export interface UseRosterSelectionReturn {
  selected: Set<string>;
  toggle: (userId: string) => void;
  toggleAll: (userIds: string[]) => void;
  clear: () => void;
  isSelected: (userId: string) => boolean;
}

export function useRosterSelection({ orgId }: { orgId: string }): UseRosterSelectionReturn {
  const [selected, setSelected] = useState<Set<string>>(() => readFromStorage(orgId));
  const orgIdRef = useRef(orgId);

  // If orgId changes, reset selection
  useEffect(() => {
    if (orgIdRef.current !== orgId) {
      orgIdRef.current = orgId;
      setSelected(readFromStorage(orgId));
    }
  }, [orgId]);

  // Persist to sessionStorage on every change
  useEffect(() => {
    writeToStorage(orgId, selected);
  }, [orgId, selected]);

  const toggle = useCallback((userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback((userIds: string[]) => {
    setSelected((prev) => {
      // If all provided userIds are already selected → deselect all
      const allSelected = userIds.length > 0 && userIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        userIds.forEach((id) => next.delete(id));
        return next;
      }
      // Otherwise add all
      const next = new Set(prev);
      userIds.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
  }, []);

  const isSelected = useCallback((userId: string) => selected.has(userId), [selected]);

  return { selected, toggle, toggleAll, clear, isSelected };
}

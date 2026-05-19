/**
 * Phase 42 Plan 42-08 — notification settings hook.
 *
 * Reads notification_settings rows for the signed-in user; returns a Map
 * keyed by `${category}:${channel}` so the NotificationsSubtab can look up
 * each cell of the 5×3 matrix in O(1).
 *
 * Pattern picked: plain React useState + useEffect against supabase-js
 * (NOT react-query — the rest of leanshot/src/components/dashboard/settings/*
 * uses direct supabase-js + Zustand state, never react-query, and adding it
 * here would expand the bundle for one screen). Optimistic updates are
 * applied to local state first, then the DB write is awaited; on failure
 * the local state rolls back.
 *
 * The upsert uses `onConflict: 'user_id,category,channel'` matching the
 * UNIQUE constraint shipped in migration 20270704000001 (Plan 42-05).
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Category, Channel, NotificationSetting } from './types';

export type SettingKey = `${Category}:${Channel}`;

export interface SettingUpdate {
  category: Category;
  channel: Channel;
  enabled?: boolean;
  snoozed_until?: string | null;
  user_cap_override?: number | null;
}

export interface UseNotificationSettingsResult {
  settings: Map<SettingKey, NotificationSetting>;
  isLoading: boolean;
  error: Error | null;
  /** Optimistic upsert against notification_settings; rolls back on failure. */
  update: (u: SettingUpdate) => Promise<{ ok: boolean; error?: string }>;
  refetch: () => Promise<void>;
}

export function keyOf(category: Category, channel: Channel): SettingKey {
  return `${category}:${channel}`;
}

export function useNotificationSettings(userId: string | null): UseNotificationSettingsResult {
  const [settings, setSettings] = useState<Map<SettingKey, NotificationSetting>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) {
      setSettings(new Map());
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from('notification_settings')
        .select('user_id, category, channel, enabled, snoozed_until, user_cap_override')
        .eq('user_id', userId);
      if (e) throw e;
      const next = new Map<SettingKey, NotificationSetting>();
      for (const row of (data ?? []) as NotificationSetting[]) {
        next.set(keyOf(row.category, row.channel), row);
      }
      setSettings(next);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const update = useCallback<UseNotificationSettingsResult['update']>(
    async (u) => {
      if (!userId) return { ok: false, error: 'not authenticated' };

      const k = keyOf(u.category, u.channel);
      const prev = settings.get(k);
      // Optimistic next-state. If no row existed yet, synthesize one with
      // safe defaults so the toggle reflects immediately.
      const optimistic: NotificationSetting = {
        user_id: userId,
        category: u.category,
        channel: u.channel,
        enabled: u.enabled ?? prev?.enabled ?? true,
        snoozed_until: u.snoozed_until ?? prev?.snoozed_until ?? null,
        user_cap_override: u.user_cap_override ?? prev?.user_cap_override ?? null,
      };
      setSettings((s) => new Map(s).set(k, optimistic));

      try {
        const { error: e } = await supabase
          .from('notification_settings')
          .upsert(optimistic, { onConflict: 'user_id,category,channel' });
        if (e) throw e;
        return { ok: true };
      } catch (e) {
        // Rollback: restore the previous row (or delete the synthetic entry).
        setSettings((s) => {
          const next = new Map(s);
          if (prev) next.set(k, prev);
          else next.delete(k);
          return next;
        });
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    [settings, userId],
  );

  return { settings, isLoading, error, update, refetch };
}

/**
 * ResearchConsentSection.tsx — Research Participation consent toggle.
 *
 * Phase 62 Plan 62-07 (INSIGHTS-05).
 *
 * HIPAA Privacy Rule §164.508 opt-in posture:
 * - Default state is ALWAYS false (off); user must explicitly enable.
 * - Toggle OFF (revoke) ALWAYS opens confirmation modal — never fire-and-forget.
 * - Toggle ON (enable) is silent — no confirmation needed.
 *
 * UI-SPEC §Surface 6 + Copywriting Contract verbatim.
 *
 * Typography ceiling (Phase 60 UI audit enforced):
 *   text-[11px] | text-[13px] | text-[18px] — nothing else.
 * Weight: font-normal | font-semibold — nothing else.
 * Color: CSS custom properties only — no undefined tokens.
 */

import { useState, useEffect, useCallback } from 'react';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

// ─── Pure helper (exported for tests) ───────────────────────────────────────

/** Returns the update payload for a revoke action — pure, no side-effects. */
export function getRevokeUpdate(): { research_consent: false; consent_revoked_at: string } {
  return {
    research_consent: false,
    consent_revoked_at: new Date().toISOString(),
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * ResearchConsentSection — settings section with toggle + revoke modal.
 *
 * Exported as both named and default per plan requirement.
 */
export function ResearchConsentSection() {
  const toast = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [showRevokeModal, setShowRevokeModal] = useState(false);

  // ─── Fetch current user + profile consent ──────────────────────────────

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) {
        if (!cancelled) setLoading(false);
        return;
      }
      setUserId(user.id);
      const { data, error } = await supabase
        .from('profiles')
        .select('research_consent, consent_revoked_at')
        .eq('id', user.id)
        .single();
      if (cancelled) return;
      if (!error && data) {
        setConsent(data.research_consent ?? false);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Toggle handler ────────────────────────────────────────────────────

  const handleToggle = useCallback(
    async (next: boolean) => {
      if (!userId) return;

      if (next) {
        // Enable: silent — no confirmation modal
        setUpdating(true);
        setConsent(true); // optimistic
        try {
          const { error } = await supabase
            .from('profiles')
            .update({ research_consent: true, consent_revoked_at: null })
            .eq('id', userId);
          if (error) throw error;
          toast('Research consent enabled.', 'success');
        } catch {
          setConsent(false); // revert on error
          toast('Failed to update consent. Please try again.', 'error');
        } finally {
          setUpdating(false);
        }
      } else {
        // Disable: must go through revoke confirmation modal
        setShowRevokeModal(true);
      }
    },
    [userId, toast],
  );

  // ─── Revoke confirm handler ─────────────────────────────────────────────

  const handleRevokeConfirm = useCallback(async () => {
    if (!userId) return;
    setUpdating(true);
    try {
      const payload = getRevokeUpdate();
      const { error } = await supabase.from('profiles').update(payload).eq('id', userId);
      if (error) throw error;
      setConsent(false);
      setShowRevokeModal(false);
      toast(
        'Research consent revoked. Your data will be removed from future rollups within 24 hours.',
        'info',
      );
    } catch {
      toast('Failed to update consent. Please try again.', 'error');
    } finally {
      setUpdating(false);
    }
  }, [userId, toast]);

  // ─── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-5 w-48 bg-[var(--color-surface-elevated)] rounded animate-pulse" />
        <div className="h-12 bg-[var(--color-surface-elevated)] rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section heading — UI-SPEC §Surface 6: 18px/600 */}
      <h3 className="text-[18px] font-semibold text-[var(--color-text)]">
        Research Participation
      </h3>

      {/* Description — UI-SPEC verbatim copy: 13px/400 text-secondary */}
      <p className="text-[13px] text-[var(--color-text-secondary)]">
        Your anonymized, aggregate data may be included in LeanShot research publications. No
        personal information is ever shared.
      </p>

      {/* Toggle row — min 44px touch target per a11y baseline */}
      <div
        className="flex items-center justify-between gap-4 min-h-[44px] py-2"
        aria-busy={updating || undefined}
      >
        <div className="flex items-center gap-2">
          <FlaskConical className="size-5 text-[var(--color-text-secondary)]" aria-hidden="true" />
          <span className="text-[13px] font-semibold text-[var(--color-text)]">
            Research consent
          </span>
          {/* Status text — UI-SPEC: 11px/400 success/text-secondary */}
          <span
            className={
              'text-[11px] font-normal ' +
              (consent ? 'text-[var(--color-success)]' : 'text-[var(--color-text-secondary)]')
            }
          >
            {consent ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        {/* Toggle switch — role="switch" per WAI-ARIA, active fill = var(--color-primary) */}
        <button
          type="button"
          role="switch"
          aria-checked={consent}
          aria-label="Research consent"
          aria-busy={updating || undefined}
          disabled={updating}
          onClick={() => void handleToggle(!consent)}
          className={
            'flex-shrink-0 inline-flex items-center justify-center w-11 h-6 rounded-full transition-colors ' +
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 ' +
            'disabled:pointer-events-none disabled:opacity-50 ' +
            (consent
              ? 'bg-[var(--color-primary)]'
              : 'bg-[var(--color-surface-elevated)] border border-[var(--color-border)]')
          }
        >
          <span
            className={
              'inline-block size-5 rounded-full bg-white shadow-sm transition-transform ' +
              (consent ? 'translate-x-2' : '-translate-x-2')
            }
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Revoke confirmation modal — UI-SPEC §Surface 6 Copywriting Contract verbatim */}
      <Modal
        open={showRevokeModal}
        onClose={() => setShowRevokeModal(false)}
        title="Revoke research consent?"
        size="sm"
        hideClose
      >
        <div className="space-y-5">
          {/* Body copy — UI-SPEC Copywriting Contract VERBATIM — 13px/400 text-secondary */}
          <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
            Revoking will remove your data from future research within 24 hours. Already-published
            papers cite aggregate cohorts, not individuals — past publications are not retracted.
          </p>

          {/* Footer — danger confirm + secondary cancel */}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {/* Cancel — "Keep consent enabled" per UI-SPEC Copywriting Contract */}
            <Button
              variant="secondary"
              onClick={() => setShowRevokeModal(false)}
              disabled={updating}
            >
              Keep consent enabled
            </Button>
            {/* Confirm — "Revoke consent" (danger) per UI-SPEC Copywriting Contract */}
            <Button
              variant="destructive"
              onClick={() => void handleRevokeConfirm()}
              loading={updating}
              aria-label="Revoke consent"
            >
              Revoke consent
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Default export per plan requirement (both named + default)
export default ResearchConsentSection;

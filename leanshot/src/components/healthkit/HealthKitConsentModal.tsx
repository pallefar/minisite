// Phase 55 Plan 55-04 — HealthKit OPT-IN consent modal (HEALTH-02).
//
// HIPAA-consent-critical: explicit opt-in, default OFF, full disclosure, firewall guarantee,
// revoke path. This is the ONLY surface where a user grants HealthKit access to LeanShot.
//
// Firewall rule: imports platform guard from ./platform (not @capacitor/core directly).
// Accent (--color-primary) is used ONLY for the primary CTA + checkbox accent.
//
// DO NOT import from any *.ad-eligible.ts, src/lib/analytics/*, src/lib/affiliate/*,
// src/lib/ads/*, src/lib/marketing/*, or src/lib/native/ads*.ts file.

import { Heart, Shield, Scale, Footprints, Moon, HeartPulse, Flame, Ruler } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { requestHealthKitAuthorization } from '@/lib/native/health';
import { detectPlatform } from '@/lib/native/platform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthKitConsentModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Called when the user dismisses via "Not now". */
  onClose: () => void;
  /** Called after a successful HealthKit authorization grant. */
  onConnected?: () => void;
}

// ---------------------------------------------------------------------------
// Data-type disclosure rows (UI-SPEC §Copywriting Contract Screen 1)
// ---------------------------------------------------------------------------

// WR-05: 'Dietary protein' removed — readDietaryProtein() always returns [] and
// dietaryProtein is NOT in the requestHealthKitAuthorization read list.
// Disclosing data you don't collect is a HIPAA consent accuracy violation and
// an App Store §5.1.3 risk. Re-add when Phase 70 implements the real read path.
const DATA_TYPES = [
  { Icon: Scale, label: 'Body weight — imported to your weight log' },
  { Icon: Footprints, label: 'Daily steps — imported to your activity log' },
  { Icon: Moon, label: 'Sleep duration — imported to your sleep log' },
  { Icon: HeartPulse, label: 'Resting heart rate — imported to your health dashboard' },
  { Icon: Flame, label: 'Active calories burned — imported to your activity log' },
  { Icon: Ruler, label: 'Height — used to calculate BMI in your weight log' },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HealthKitConsentModal({
  open,
  onClose,
  onConnected,
}: HealthKitConsentModalProps) {
  const toast = useToast();
  const [checked, setChecked] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const platform = detectPlatform();
  const isIos = platform === 'ios';

  const handleConnect = async (): Promise<void> => {
    if (!checked || connecting) return;
    setConnecting(true);
    try {
      const granted = await requestHealthKitAuthorization();
      if (granted) {
        toast('Apple Health connected. Starting initial sync…', 'success');
        onConnected?.();
      } else {
        toast(
          'Apple Health access was denied. Grant access in iOS Settings > Privacy > Health > LeanShot.',
          'error',
        );
      }
    } catch {
      toast(
        'Apple Health access was denied. Grant access in iOS Settings > Privacy > Health > LeanShot.',
        'error',
      );
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect Apple Health"
      size="md"
      mobileFullscreen
      dismissible={false}
      hideClose
    >
      {/* Platform guard — non-iOS: unavailable message only */}
      {!isIos ? (
        <div className="py-6 text-center space-y-3">
          <Heart className="size-10 mx-auto text-[var(--color-text-tertiary)]" aria-hidden />
          <h2 className="text-[18px] font-semibold text-[var(--color-text)]">Apple Health</h2>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Apple Health sync is only available on iPhone.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Hero icon + lead */}
          <div className="flex flex-col items-center gap-3 text-center">
            <Heart
              className="size-8 text-[var(--color-primary)]"
              aria-hidden
            />
            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed max-w-prose">
              LeanShot can read health data from Apple Health to automatically track your weight,
              steps, sleep, and heart rate alongside your GLP-1 journey.
            </p>
          </div>

          {/* Data-type disclosure list */}
          <Card variant="default" padding="sm">
            <p className="text-[13px] font-semibold text-[var(--color-text)] mb-2">
              What we read from Apple Health
            </p>
            <ul className="space-y-1">
              {DATA_TYPES.map(({ Icon, label }) => (
                <li key={label} className="flex items-center gap-2 p-3">
                  <Icon
                    className="size-4 text-[var(--color-text-secondary)] shrink-0"
                    aria-hidden
                  />
                  <span className="text-[13px] text-[var(--color-text-secondary)]">{label}</span>
                </li>
              ))}
            </ul>
          </Card>

          {/* Firewall guarantee card */}
          <Card
            variant="default"
            padding="sm"
            className="bg-[var(--color-primary-soft)] border-[var(--color-primary-soft)]"
          >
            <div className="flex gap-2 items-start">
              <Shield
                className="size-4 text-[var(--color-primary)] shrink-0 mt-0.5"
                aria-hidden
              />
              <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
                Your health data is used only to populate your personal dashboard. It is{' '}
                <strong>never</strong> shared with ad networks, marketing systems, or any third
                party.
              </p>
            </div>
          </Card>

          {/* Retention disclosure */}
          <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
            Imported data is stored in your LeanShot account subject to the same data-retention
            rules as manually logged data. You can revoke access and delete imported data at any
            time from Settings.
          </p>

          {/* Revoke-path disclosure */}
          <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
            To disconnect Apple Health, go to Settings &gt; HealthKit. You can also revoke access
            directly in the iOS Health app under Settings &gt; Privacy &gt; Health.
          </p>

          {/* Privacy policy caption */}
          <p className="text-[11px] text-[var(--color-text-tertiary)]">
            See our Privacy Policy for full details.
          </p>

          {/* Acknowledgement checkbox — native <input> per UI-SPEC §Accessibility Contract */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 size-4 rounded accent-[var(--color-primary)] shrink-0"
              aria-label="I understand that LeanShot will read the data types listed above from Apple Health."
            />
            <span className="text-[13px] font-semibold text-[var(--color-text)] leading-snug">
              I understand that LeanShot will read the data types listed above from Apple Health.
            </span>
          </label>

          {/* Footer buttons */}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={onClose} disabled={connecting}>
              Not now
            </Button>
            <Button
              variant="primary"
              disabled={!checked}
              aria-disabled={!checked}
              loading={connecting}
              onClick={() => {
                void handleConnect();
              }}
            >
              Connect Apple Health
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

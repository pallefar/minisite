/**
 * Phase 25 Plan 25-09 — ExpiryBanner.
 * HIPAA-13: Shows a colored banner if any vendor BAA is within 60 days of expiry
 * or has already expired.
 *
 * Color coding (per CONTEXT specifics):
 *   - expired / 0–13d: red ("COMPLIANCE GAP" or "CRITICAL")
 *   - 14–29d: orange
 *   - 30–60d: amber
 *
 * Data: reads vendor_baa_chain (RLS auto-scopes to staff per Plan 25-01).
 * No PHI: vendor names + dates are non-PHI.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface VendorExpiry {
  vendor_name: string;
  baa_expiry_at: string | null;
  status: string;
}

interface BannerInfo {
  severity: 'red' | 'orange' | 'amber';
  message: string;
}

function daysUntil(expiryAt: string): number {
  const diffMs = new Date(expiryAt).getTime() - Date.now();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function computeBanner(vendors: VendorExpiry[]): BannerInfo | null {
  const expired = vendors.filter((v) => v.status === 'expired');
  const criticalVendors = vendors.filter(
    (v) =>
      v.status === 'signed' &&
      v.baa_expiry_at !== null &&
      daysUntil(v.baa_expiry_at) < 14,
  );
  const orangeVendors = vendors.filter(
    (v) =>
      v.status === 'signed' &&
      v.baa_expiry_at !== null &&
      daysUntil(v.baa_expiry_at) >= 14 &&
      daysUntil(v.baa_expiry_at) < 30,
  );
  const amberVendors = vendors.filter(
    (v) =>
      v.status === 'signed' &&
      v.baa_expiry_at !== null &&
      daysUntil(v.baa_expiry_at) >= 30 &&
      daysUntil(v.baa_expiry_at) <= 60,
  );

  if (expired.length > 0) {
    const names = expired.map((v) => v.vendor_name).join(', ');
    return {
      severity: 'red',
      message: `COMPLIANCE GAP: BAA expired for ${names}. Renew immediately.`,
    };
  }
  if (criticalVendors.length > 0) {
    const names = criticalVendors.map((v) => {
      const d = daysUntil(v.baa_expiry_at!);
      return `${v.vendor_name} (${d}d)`;
    }).join(', ');
    return {
      severity: 'red',
      message: `CRITICAL: BAA expiring in <14 days for ${names}.`,
    };
  }
  if (orangeVendors.length > 0) {
    const names = orangeVendors.map((v) => {
      const d = daysUntil(v.baa_expiry_at!);
      return `${v.vendor_name} (${d}d)`;
    }).join(', ');
    return {
      severity: 'orange',
      message: `BAA renewal due in 14–29 days for ${names}.`,
    };
  }
  if (amberVendors.length > 0) {
    const names = amberVendors.map((v) => {
      const d = daysUntil(v.baa_expiry_at!);
      return `${v.vendor_name} (${d}d)`;
    }).join(', ');
    return {
      severity: 'amber',
      message: `BAA renewal approaching (30–60 days) for ${names}.`,
    };
  }
  return null;
}

const SEVERITY_CLASSES: Record<BannerInfo['severity'], string> = {
  red: 'bg-red-50 border-red-400 text-red-800',
  orange: 'bg-orange-50 border-orange-400 text-orange-800',
  amber: 'bg-amber-50 border-amber-400 text-amber-800',
};

export function ExpiryBanner() {
  const [banner, setBanner] = useState<BannerInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      const { data, error } = await supabase
        .from('vendor_baa_chain')
        .select('vendor_name, baa_expiry_at, status');

      if (cancelled) return;
      setLoading(false);

      if (error) {
        console.warn('[ExpiryBanner] query failed', error.message);
        return;
      }

      setBanner(computeBanner((data ?? []) as VendorExpiry[]));
    }

    void fetch();
    return () => { cancelled = true; };
  }, []);

  if (loading || banner === null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm font-medium ${SEVERITY_CLASSES[banner.severity]}`}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-base leading-none">
        {banner.severity === 'red' ? '🔴' : banner.severity === 'orange' ? '🟠' : '🟡'}
      </span>
      <span>{banner.message}</span>
    </div>
  );
}

/**
 * Pure utility helpers — date, formatting, escape.
 * Ported from v1 (leanshot.html:3654-3672).
 */

export const todayStr = (): string => new Date().toISOString().slice(0, 10);

export const shortLabel = (s: string): string => {
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export const formatShort = (s: string): string => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const formatLong = (s: string): string => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export const lastNDays = (n: number): string[] => {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

export const daysBetween = (a: string | Date, b: string | Date): number =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

export const hoursSince = (iso: string): number =>
  (Date.now() - new Date(iso).getTime()) / 3_600_000;

export const escapeHtml = (s: string | null | undefined): string =>
  (s ?? '')
    .toString()
    .replace(
      /[&<>"']/g,
      (c) =>
        (
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }) as Record<
            string,
            string
          >
        )[c],
    );

export const cn = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');

export const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

export const pct = (v: number, target: number): number =>
  target > 0 ? clamp((v / target) * 100, 0, 100) : 0;

/** Greeting based on local time. */
export const greeting = (): 'morning' | 'afternoon' | 'evening' => {
  const h = new Date().getHours();
  if (h < 5) return 'evening';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
};

/** Friendly relative time. */
export const relTime = (iso: string): string => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
};

/** Format a duration in hours into a human-readable string. */
export const formatDuration = (hours: number): string => {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
};

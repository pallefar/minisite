/**
 * Phase 31 Plan 31-03 — brand-tokens.ts
 *
 * Pre-mount brand-token library for path-based white-label per D-07 (ORG-11).
 *
 * Design contract:
 *   1. parseClinicSlug — parse the /clinic/{slug} path to extract the slug.
 *   2. applyBrandTokens — synchronously mutate <html> CSS custom properties
 *      (follows the applyThemeToDOM pattern in src/hooks/useTheme.ts).
 *   3. fetchClinicBranding — bare fetch() against the public SECDEF RPC
 *      resolve_clinic_branding. NEVER imports supabase-js (singleton not yet
 *      constructed at pre-mount time — see Phase 6 D-12 deferred sync init).
 *
 * Why bare fetch and not supabase-js:
 *   At the point main.tsx runs the pre-mount block, supabase-js is NOT yet in
 *   the module graph — it is loaded lazily via scheduleSyncInit() AFTER first
 *   render (Phase 6 D-12). Importing it here would pull the full @supabase/
 *   supabase-js bundle into the entry chunk, defeating the deferred-init
 *   pattern that keeps the index chunk under its 18.1 kB gz ceiling.
 *
 * Env-var access: STATIC literal lookups only — per [[reference_vite_static_env_inlining]]:
 *   import.meta.env.VITE_SUPABASE_URL
 *   import.meta.env.VITE_SUPABASE_ANON_KEY
 *   (dynamic import.meta.env[`VITE_${x}`] keys are NOT build-time replaced)
 *
 * Favicon: injected as <link rel="icon"> by main.tsx (not a CSS variable) —
 *   favicons are <link> tags, not styleable CSS properties.
 *
 * See: 31-CONTEXT.md D-05 (token map), D-07 (pre-mount fetch mechanism)
 *      31-UI-SPEC.md §Surface 4 (brand overlay tokens)
 */

// ---------------------------------------------------------------------------
// Brand overlay CSS variable names (suffixes used as --brand-{key} on <html>)
// ---------------------------------------------------------------------------

export const BRAND_TOKEN_KEYS = [
  'primary',
  'accent',
  'bg',
  'text',
  'logo',
  'heading-font',
  'body-font',
  'radius',
] as const;

export type BrandTokenKey = (typeof BRAND_TOKEN_KEYS)[number];

// ---------------------------------------------------------------------------
// localStorage cache key prefix
// ---------------------------------------------------------------------------

/**
 * localStorage cache key for a given slug: BRAND_CACHE_KEY_PREFIX + slug
 * (e.g. 'leanshot_brand_glp1-clinic')
 */
export const BRAND_CACHE_KEY_PREFIX = 'leanshot_brand_';

// ---------------------------------------------------------------------------
// BrandTokens interface — mirrors the resolve_clinic_branding RPC return shape
// (31-CONTEXT.md D-05 + 31-03-PLAN.md key_decisions_to_lock #2)
// ---------------------------------------------------------------------------

export interface BrandTokens {
  org_id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  favicon_url: string | null;
  logo_alt_text: string;
  primary_color: string | null;
  accent_color: string | null;
  bg_color: string | null;
  text_color: string | null;
  heading_font: string | null;
  body_font: string | null;
  radius_scale: 'sm' | 'md' | 'lg' | 'xl' | null;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Radius scale → CSS rem value mapping
// Matches --radius-sm / --radius / --radius-lg / --radius-xl in src/index.css
// ---------------------------------------------------------------------------

const RADIUS_MAP: Record<NonNullable<BrandTokens['radius_scale']>, string> = {
  sm: '0.625rem',
  md: '0.875rem',
  lg: '1.25rem',
  xl: '1.5rem',
};

// ---------------------------------------------------------------------------
// parseClinicSlug
// ---------------------------------------------------------------------------

/**
 * Parse /clinic/{slug} from a pathname.
 *
 * @param pathname - e.g. window.location.pathname
 * @returns the slug string (e.g. 'glp1-clinic') or null if not a clinic path.
 *
 * Pattern: ^/clinic/([^/]+)
 * Handles:
 *   /clinic/glp1-clinic          → 'glp1-clinic'
 *   /clinic/glp1-clinic/dashboard → 'glp1-clinic'
 *   /clinic/abc                  → 'abc'
 *   /clinic/                     → null (no slug)
 *   /clinic                      → null (no trailing segment)
 *   /                            → null
 *   /dashboard                   → null
 */
export function parseClinicSlug(pathname: string): string | null {
  const match = pathname.match(/^\/clinic\/([^/]+)/);
  return match ? match[1] ?? null : null;
}

// ---------------------------------------------------------------------------
// applyBrandTokens
// ---------------------------------------------------------------------------

/**
 * Synchronously apply (or clear) brand CSS custom properties on <html>.
 *
 * Follows the applyThemeToDOM pattern (src/hooks/useTheme.ts): synchronous,
 * mutates document.documentElement directly, returns void.
 *
 * - null tokens → clear all --brand-* properties (removeProperty)
 * - non-null tokens → set each non-null field; clear null fields
 * - logo_url → --brand-logo as CSS url("...") wrapper
 * - radius_scale → --brand-radius mapped to rem value
 */
export function applyBrandTokens(tokens: BrandTokens | null): void {
  const el = document.documentElement;

  if (tokens === null) {
    // Clear all brand overlay properties
    for (const key of BRAND_TOKEN_KEYS) {
      el.style.removeProperty(`--brand-${key}`);
    }
    return;
  }

  // primary_color → --brand-primary
  if (tokens.primary_color !== null) {
    el.style.setProperty('--brand-primary', tokens.primary_color);
  } else {
    el.style.removeProperty('--brand-primary');
  }

  // accent_color → --brand-accent
  if (tokens.accent_color !== null) {
    el.style.setProperty('--brand-accent', tokens.accent_color);
  } else {
    el.style.removeProperty('--brand-accent');
  }

  // bg_color → --brand-bg
  if (tokens.bg_color !== null) {
    el.style.setProperty('--brand-bg', tokens.bg_color);
  } else {
    el.style.removeProperty('--brand-bg');
  }

  // text_color → --brand-text
  if (tokens.text_color !== null) {
    el.style.setProperty('--brand-text', tokens.text_color);
  } else {
    el.style.removeProperty('--brand-text');
  }

  // logo_url → --brand-logo (CSS url("...") wrapper)
  if (tokens.logo_url !== null) {
    el.style.setProperty('--brand-logo', `url("${tokens.logo_url}")`);
  } else {
    el.style.removeProperty('--brand-logo');
  }

  // heading_font → --brand-heading-font
  if (tokens.heading_font !== null) {
    el.style.setProperty('--brand-heading-font', tokens.heading_font);
  } else {
    el.style.removeProperty('--brand-heading-font');
  }

  // body_font → --brand-body-font
  if (tokens.body_font !== null) {
    el.style.setProperty('--brand-body-font', tokens.body_font);
  } else {
    el.style.removeProperty('--brand-body-font');
  }

  // radius_scale → --brand-radius (mapped to rem value)
  if (tokens.radius_scale !== null) {
    el.style.setProperty('--brand-radius', RADIUS_MAP[tokens.radius_scale]);
  } else {
    el.style.removeProperty('--brand-radius');
  }
}

// ---------------------------------------------------------------------------
// fetchClinicBranding
// ---------------------------------------------------------------------------

/**
 * Fetch the brand token blob from the public SECDEF RPC.
 *
 * Uses bare fetch() — NOT supabase-js (see module-level comment).
 * NEVER throws: returns null on network error, JSON parse error, or bad slug.
 *
 * @param slug - The clinic slug (e.g. 'glp1-clinic')
 * @returns BrandTokens on success, null on bad slug / RPC error / network failure
 */
export async function fetchClinicBranding(slug: string): Promise<BrandTokens | null> {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

    if (!supabaseUrl || !anonKey) return null;

    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/resolve_clinic_branding`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_slug: slug }),
    });

    if (!response.ok) return null;

    // SQL NULL from the SECDEF returns JSON `null` in the body
    const data: BrandTokens | null = (await response.json()) as BrandTokens | null;
    return data ?? null;
  } catch {
    // Network down, JSON parse error, or any other thrown error → graceful null
    return null;
  }
}

/**
 * Phase 68 Plan 68-03 — `AudienceLandingPage` tests.
 *
 * Coverage:
 *   T1 — `/for-doctors` fetch resolves: hero headline rendered + Helmet
 *        emits a JSON-LD <script> with `audience.audienceType=Physicians`
 *        and `serviceType=PatientDataReadShare`.
 *   T2 — `/for-clinics` fetch resolves: Calendly placeholder href is NOT
 *        rendered as a literal `${...}` string — falls back to a disabled
 *        "Coming soon" button per
 *        [[feedback_placeholder_string_runtime_guard_pattern]].
 *   T3 — `/for-coaches` fetch resolves: JSON-LD payload includes
 *        `audienceType=Wellness Coaches` + `serviceType=CohortCoachingTool`.
 *   T4 — fetch returns null → 404 view rendered (no JSON-LD script tag).
 */

import { render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Supabase mock (chainable builder + per-test rows) ─────────────────────

interface PageRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  published_revision_id: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_schema_type: string | null;
}

interface RevRow {
  id: string;
  page_id: string;
  block_tree: unknown[];
  created_at?: string;
}

let mockPages: PageRow[] = [];
let mockRevisions: RevRow[] = [];

function makePageBuilder(): Record<string, unknown> {
  const filters: { slug?: string; status?: string } = {};
  const builder: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockImplementation((col: string, val: string) => {
      if (col === 'slug') filters.slug = val;
      if (col === 'status') filters.status = val;
      return builder;
    }),
    maybeSingle: vi.fn().mockImplementation(() => {
      const found = mockPages.find(
        (p) =>
          p.slug === filters.slug &&
          (filters.status === undefined || p.status === filters.status),
      );
      return Promise.resolve({ data: found ?? null, error: null });
    }),
  };
  return builder;
}

function makeRevisionBuilder(): Record<string, unknown> {
  const filters: { id?: string; page_id?: string } = {};
  const builder: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockImplementation((col: string, val: string) => {
      if (col === 'id') filters.id = val;
      if (col === 'page_id') filters.page_id = val;
      return builder;
    }),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockImplementation(() => {
      let found: RevRow | undefined;
      if (filters.id) {
        found = mockRevisions.find((r) => r.id === filters.id);
      } else if (filters.page_id) {
        found = mockRevisions
          .filter((r) => r.page_id === filters.page_id)
          .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
      }
      return Promise.resolve({ data: found ?? null, error: null });
    }),
  };
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'landing_pages') return makePageBuilder();
      if (table === 'landing_page_revisions') return makeRevisionBuilder();
      throw new Error(`unexpected table: ${table}`);
    },
  },
}));

// ─── Import after mock so vi.mock is hoisted correctly ─────────────────────

import { AudienceLandingPage } from '@/components/landing/AudienceLandingPage';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function seedDoctorPage(): void {
  mockPages.push({
    id: 'doc-page-id',
    slug: '/for-doctors',
    title: 'LeanShot for Doctors',
    status: 'published',
    published_revision_id: 'doc-rev-id',
    seo_title: 'LeanShot for Doctors — Read-only Patient Data',
    seo_description:
      "View your GLP-1 patient's injection log, weight, and adherence via secure read-share.",
    seo_schema_type: 'Service',
  });
  mockRevisions.push({
    id: 'doc-rev-id',
    page_id: 'doc-page-id',
    block_tree: [
      {
        type: 'hero',
        headline: 'Read-only patient data — exactly what you need.',
        subhead: 'When your GLP-1 patient shares their LeanShot account…',
        cta: { label: 'See sample report', href: '/sample-doctor-report' },
      },
      {
        type: 'feature-grid',
        features: [
          { icon: 'eye', title: 'Read-share', body: 'No login.' },
          { icon: 'shield-check', title: 'HIPAA-aware', body: 'Read-only access.' },
        ],
      },
      { type: 'cta', label: 'Get patient-shared access', href: '/auth/doctor-invite' },
    ],
  });
}

function seedClinicPage(): void {
  mockPages.push({
    id: 'clinic-page-id',
    slug: '/for-clinics',
    title: 'LeanShot for Clinics',
    status: 'published',
    published_revision_id: 'clinic-rev-id',
    seo_title: 'LeanShot for Clinics — GLP-1 Patient Monitoring',
    seo_description: 'Multi-patient GLP-1 monitoring with HIPAA-BAA + per-patient pricing.',
    seo_schema_type: 'Service',
  });
  mockRevisions.push({
    id: 'clinic-rev-id',
    page_id: 'clinic-page-id',
    block_tree: [
      {
        type: 'hero',
        headline: 'Multi-patient monitoring built for GLP-1 clinics.',
        subhead: 'Roster, per-patient pricing, HIPAA-BAA.',
        cta: { label: 'Book a demo', href: '${CALENDLY_BOOK_DEMO_URL_PLACEHOLDER}' },
      },
    ],
  });
}

function seedCoachPage(): void {
  mockPages.push({
    id: 'coach-page-id',
    slug: '/for-coaches',
    title: 'LeanShot for Coaches',
    status: 'published',
    published_revision_id: 'coach-rev-id',
    seo_title: 'LeanShot for Coaches — Wellness Cohort Tracking',
    seo_description: 'Manage your GLP-1 / peptide coaching clients.',
    seo_schema_type: 'Service',
  });
  mockRevisions.push({
    id: 'coach-rev-id',
    page_id: 'coach-page-id',
    block_tree: [
      {
        type: 'hero',
        headline: 'Manage your wellness cohort with one tool.',
        subhead: 'Track your coaching clients.',
        cta: { label: 'Start free trial', href: '/signup?audience=coach' },
      },
    ],
  });
}

// ─── Render helper ─────────────────────────────────────────────────────────

function renderWithHelmet(slug: string) {
  return render(
    <HelmetProvider>
      <AudienceLandingPage slugOverride={slug} />
    </HelmetProvider>,
  );
}

/**
 * Helmet writes to document.head asynchronously after mount. Pull the most
 * recently rendered JSON-LD script element from `document.head` and parse it.
 */
async function getJsonLdPayload(): Promise<Record<string, unknown> | null> {
  // Wait for Helmet to flush the <script> into the head.
  let parsed: Record<string, unknown> | null = null;
  await waitFor(
    () => {
      const scripts = Array.from(
        document.head.querySelectorAll('script[type="application/ld+json"]'),
      );
      if (scripts.length === 0) throw new Error('no JSON-LD script yet');
      const raw = scripts[scripts.length - 1]!.textContent ?? '';
      // The component escapes `<` as `<` — un-escape for parse.
      const unescaped = raw.replace(/\\u003c/g, '<');
      parsed = JSON.parse(unescaped) as Record<string, unknown>;
    },
    { timeout: 2000 },
  );
  return parsed;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('AudienceLandingPage', () => {
  beforeEach(() => {
    mockPages = [];
    mockRevisions = [];
    // Reset head between tests (Helmet leaves the prior <script> in head
    // otherwise, which makes per-test JSON-LD assertions cross-pollinate).
    document.head.querySelectorAll('script[type="application/ld+json"]').forEach((n) => {
      n.parentNode?.removeChild(n);
    });
  });

  it('T1: /for-doctors renders hero headline + JSON-LD with Physicians audience', async () => {
    seedDoctorPage();
    renderWithHelmet('/for-doctors');

    // Hero headline appears after async fetch resolves.
    await screen.findByText(/Read-only patient data/i);

    // JSON-LD emitted via Helmet contains correct audience + serviceType.
    const ld = await getJsonLdPayload();
    expect(ld).not.toBeNull();
    expect(ld!['@type']).toBe('Service');
    expect(ld!.serviceType).toBe('PatientDataReadShare');
    const audience = ld!.audience as { '@type': string; audienceType: string };
    expect(audience['@type']).toBe('MedicalAudience');
    expect(audience.audienceType).toBe('Physicians');
  });

  it('T2: /for-clinics renders "Coming soon" disabled button when Calendly env unset (no literal ${...} string)', async () => {
    seedClinicPage();
    renderWithHelmet('/for-clinics');

    // Headline confirms the page resolved.
    await screen.findByText(/Multi-patient monitoring/i);

    // The literal placeholder MUST NOT appear in the DOM.
    expect(document.body.textContent).not.toContain('${CALENDLY_BOOK_DEMO_URL_PLACEHOLDER}');

    // A disabled "Coming soon" button is rendered instead.
    const comingSoon = await screen.findByRole('button', { name: /coming soon/i });
    expect(comingSoon).toBeDisabled();

    // And the JSON-LD audience is BusinessAudience / GLP-1 Clinics.
    const ld = await getJsonLdPayload();
    const audience = ld!.audience as { '@type': string; audienceType: string };
    expect(audience['@type']).toBe('BusinessAudience');
    expect(audience.audienceType).toBe('GLP-1 Clinics');
    expect(ld!.serviceType).toBe('MultiPatientMonitoring');
  });

  it('T3: /for-coaches JSON-LD has audienceType=Wellness Coaches + serviceType=CohortCoachingTool', async () => {
    seedCoachPage();
    renderWithHelmet('/for-coaches');

    await screen.findByText(/Manage your wellness cohort/i);

    const ld = await getJsonLdPayload();
    expect(ld!['@type']).toBe('Service');
    expect(ld!.serviceType).toBe('CohortCoachingTool');
    const audience = ld!.audience as { '@type': string; audienceType: string };
    expect(audience['@type']).toBe('BusinessAudience');
    expect(audience.audienceType).toBe('Wellness Coaches');
  });

  it('T4: unknown slug → 404 view, no JSON-LD script tag in head', async () => {
    // No fixtures seeded → fetch returns null for every slug.
    renderWithHelmet('/for-nonexistent');

    // 404 view copy renders.
    await screen.findByText(/this page isn't available/i);

    // No JSON-LD <script> was emitted.
    const scripts = document.head.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts.length).toBe(0);
  });
});

/**
 * Phase 41 Plan 41-05 Task 1 — ConsentGatedEmbed HOC + EmbedPlaceholderCard tests.
 *
 * 7 behavior cases per PLAN.md <behavior>:
 *   1. State 1 (no consent): renders placeholder, NO iframe in DOM.
 *   2. State 1 → State 2/3 on event: dispatch consent-change with categories=true
 *      flips to State 2 (Skeleton + iframe opacity-0); iframe onLoad → State 3.
 *   3. State 3 → State 1 on revoke: iframe UNMOUNTED (querySelector('iframe') null).
 *   4. Mount-race defense: synchronous true at mount → State 2 without event.
 *   5. Reduced motion: iframe className has NO 'transition-opacity'.
 *   6. A11y: State 2 wrapping Card has aria-busy='true'; iframe has title.
 *   7. EmbedPlaceholderCard copy: calendly provider renders verbatim heading.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_CHANGE_EVENT, type ConsentChangeDetail } from '@/lib/consent/consent-event';
import { ConsentGatedEmbed } from '../ConsentGatedEmbed';
import { EmbedPlaceholderCard } from '../EmbedPlaceholderCard';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const acceptedCategoryMock = vi.fn((_cat: string) => false);
vi.mock('vanilla-cookieconsent', () => ({
  acceptedCategory: (cat: string) => acceptedCategoryMock(cat),
  show: vi.fn(),
}));

// useReducedMotion mock — flipped per-test via setReduceMotion.
let reduceMotionValue = false;
vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => reduceMotionValue,
}));

function setReduceMotion(v: boolean) {
  reduceMotionValue = v;
}

function dispatchConsentChange(categories: Partial<ConsentChangeDetail['categories']>) {
  const detail: ConsentChangeDetail = {
    categories: {
      necessary: true,
      analytics: false,
      marketing: false,
      personalization: false,
      functional: true,
      ...categories,
    },
  };
  act(() => {
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail }));
  });
}

describe('ConsentGatedEmbed HOC (Phase 41 41-05 Task 1)', () => {
  beforeEach(() => {
    acceptedCategoryMock.mockReset();
    acceptedCategoryMock.mockImplementation(() => false);
    setReduceMotion(false);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('Test 1 (State 1 — no consent): renders ONLY EmbedPlaceholderCard, no iframe', () => {
    acceptedCategoryMock.mockImplementation(() => false);

    render(
      <ConsentGatedEmbed
        provider="youtube"
        categories={['analytics', 'marketing']}
        aspectRatio="16/9"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        title="A video"
        src="https://www.youtube-nocookie.com/embed/abc"
      />,
    );

    // No iframe in placeholder state.
    expect(document.querySelector('iframe')).toBeNull();
    // Placeholder card heading present (calendly fallback not used here; per-provider copy).
    expect(screen.getByText(/Enable analytics and marketing cookies to view this YouTube video/i)).toBeTruthy();
  });

  it('Test 2 (State 1 → State 2/3 on consent grant event): iframe appears with opacity-0, onLoad → opacity-1', () => {
    acceptedCategoryMock.mockImplementation(() => false);

    render(
      <ConsentGatedEmbed
        provider="youtube"
        categories={['analytics', 'marketing']}
        aspectRatio="16/9"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        title="A video"
        src="https://www.youtube-nocookie.com/embed/abc"
      />,
    );

    // Initially no iframe.
    expect(document.querySelector('iframe')).toBeNull();

    // Grant analytics + marketing → State 2. Update both the canonical
    // CookieConsent state (HOC re-reads acceptedCategory to defend against
    // spoofed events — T-41-05-06) and dispatch the change event.
    acceptedCategoryMock.mockImplementation((cat) => cat === 'analytics' || cat === 'marketing');
    dispatchConsentChange({ analytics: true, marketing: true });

    const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(iframe!.className).toContain('opacity-0');

    // Fire onLoad → State 3.
    act(() => {
      fireEvent.load(iframe!);
    });
    const iframeAfter = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframeAfter.className).toContain('opacity-100');
  });

  it('Test 3 (State 3 → State 1 on revoke): iframe UNMOUNTS entirely (not src="")', () => {
    acceptedCategoryMock.mockImplementation((cat) => cat === 'analytics' || cat === 'marketing');

    render(
      <ConsentGatedEmbed
        provider="youtube"
        categories={['analytics', 'marketing']}
        aspectRatio="16/9"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        title="A video"
        src="https://www.youtube-nocookie.com/embed/abc"
      />,
    );

    // Initially mounted (mount-race read).
    expect(document.querySelector('iframe')).not.toBeNull();

    // Revoke analytics — required category gone.
    acceptedCategoryMock.mockImplementation((cat) => cat === 'marketing');
    dispatchConsentChange({ analytics: false, marketing: true });

    // Iframe must be removed (not src='' anti-pattern).
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('Test 4 (mount-race defense): synchronous acceptedCategory=true at mount → State 2 without event', () => {
    acceptedCategoryMock.mockImplementation(() => true);

    render(
      <ConsentGatedEmbed
        provider="calendly"
        categories={['functional', 'analytics']}
        minHeight={700}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        title="Schedule a meeting"
        src="https://calendly.com/me/30min"
      />,
    );

    expect(document.querySelector('iframe')).not.toBeNull();
  });

  it('Test 5 (reduced motion): iframe className does NOT contain "transition-opacity"', () => {
    setReduceMotion(true);
    acceptedCategoryMock.mockImplementation(() => true);

    render(
      <ConsentGatedEmbed
        provider="tally"
        categories={['functional']}
        minHeight={500}
        sandbox="allow-scripts allow-same-origin allow-forms"
        title="Tally form"
        src="https://tally.so/r/abc"
      />,
    );

    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.className).not.toContain('transition-opacity');
  });

  it('Test 6 (a11y): State 2 wrapping Card has aria-busy="true"; iframe has title', () => {
    acceptedCategoryMock.mockImplementation(() => true);

    render(
      <ConsentGatedEmbed
        provider="tally"
        categories={['functional']}
        minHeight={500}
        sandbox="allow-scripts allow-same-origin allow-forms"
        title="Tally form"
        src="https://tally.so/r/abc"
      />,
    );

    // Card carrier has aria-busy=true while iframe not yet loaded.
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();

    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('title')).toBe('Tally form');
  });

  it('Test 7 (EmbedPlaceholderCard copy — calendly heading verbatim + Manage preferences link)', () => {
    render(
      <EmbedPlaceholderCard provider="calendly" categories={['functional', 'analytics']} />,
    );

    expect(
      screen.getByText('Enable functional and analytics cookies to view this Calendly meeting'),
    ).toBeTruthy();
    expect(screen.getByText(/Manage cookie preferences/i)).toBeTruthy();
  });
});

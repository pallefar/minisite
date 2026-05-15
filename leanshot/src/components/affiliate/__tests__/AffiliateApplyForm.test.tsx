/**
 * Phase 19 Plan 19-05 — AffiliateApplyForm RTL coverage.
 *
 * Coverage:
 *   T1: renders all 5 fields with correct labels
 *   T2: invalid email shows error message below the field
 *   T3: why_us > 500 chars shows counter-error + blocks submit
 *   T4: valid form submit → supabase.functions.invoke called with correct body
 *   T5: 200 response → success-state heading replaces form body
 *   T6: native <select> has exactly 6 options matching D-05 enum
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AffiliateApplyForm } from '@/components/affiliate/AffiliateApplyForm';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

const mockedInvoke = vi.mocked(supabase.functions.invoke);

describe('<AffiliateApplyForm /> — Plan 19-05', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T1 — renders all 5 fields with correct labels', () => {
    render(<AffiliateApplyForm />);
    expect(
      screen.getByRole('heading', { name: /Apply to the LeanShot affiliate program/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Your email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Your name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Audience size/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Primary audience/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Why us\?/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit application/i })).toBeInTheDocument();
  });

  it('T2 — invalid email shows error message below the field', async () => {
    const user = userEvent.setup();
    render(<AffiliateApplyForm />);
    await user.type(screen.getByLabelText(/Your email/i), 'not-an-email');
    await user.type(screen.getByLabelText(/Your name/i), 'Casey');
    await user.type(screen.getByLabelText(/Audience size/i), '1000');
    await user.selectOptions(screen.getByLabelText(/Primary audience/i), 'Instagram');
    await user.type(screen.getByLabelText(/Why us\?/i), 'I help my audience.');
    await user.click(screen.getByRole('button', { name: /Submit application/i }));

    await waitFor(() =>
      expect(screen.getByText(/Please enter a valid email address/i)).toBeInTheDocument(),
    );
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('T3 — why_us > 500 chars shows counter-error + blocks submit', async () => {
    const user = userEvent.setup();
    render(<AffiliateApplyForm />);
    await user.type(screen.getByLabelText(/Your email/i), 'creator@example.com');
    await user.type(screen.getByLabelText(/Your name/i), 'Casey');
    await user.type(screen.getByLabelText(/Audience size/i), '1000');
    await user.selectOptions(screen.getByLabelText(/Primary audience/i), 'Instagram');
    // 501 chars — userEvent.type is slow with that volume; use clipboard-like paste.
    const tooLong = 'x'.repeat(501);
    const whyUs = screen.getByLabelText(/Why us\?/i);
    // paste via fireEvent-style direct value set through userEvent.paste
    whyUs.focus();
    await user.paste(tooLong);
    await user.click(screen.getByRole('button', { name: /Submit application/i }));

    await waitFor(() =>
      expect(screen.getByText(/Keep it under 500 characters/i)).toBeInTheDocument(),
    );
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('T4 — valid form submit → supabase.functions.invoke called with correct body', async () => {
    mockedInvoke.mockResolvedValueOnce({
      data: { ok: true },
      error: null,
    } as never);
    const user = userEvent.setup();
    render(<AffiliateApplyForm />);
    await user.type(screen.getByLabelText(/Your email/i), 'creator@example.com');
    await user.type(screen.getByLabelText(/Your name/i), 'Casey Creator');
    await user.type(screen.getByLabelText(/Audience size/i), '12000');
    await user.selectOptions(screen.getByLabelText(/Primary audience/i), 'Instagram');
    await user.type(
      screen.getByLabelText(/Why us\?/i),
      'I coach GLP-1 patients full-time and audience asks every week which app I use.',
    );
    await user.click(screen.getByRole('button', { name: /Submit application/i }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledTimes(1));
    const [fnName, opts] = mockedInvoke.mock.calls[0]!;
    expect(fnName).toBe('affiliate-apply');
    expect(opts).toBeDefined();
    const body = (opts as { body: Record<string, unknown> }).body;
    expect(body.email).toBe('creator@example.com');
    expect(body.name).toBe('Casey Creator');
    expect(body.audience_size).toBe(12000);
    expect(body.audience_type).toBe('Instagram');
    expect(typeof body.why_us).toBe('string');
    expect(body.honeypot).toBe('');
  });

  it('T5 — 200 response → success-state heading replaces form body', async () => {
    mockedInvoke.mockResolvedValueOnce({
      data: { ok: true },
      error: null,
    } as never);
    const user = userEvent.setup();
    render(<AffiliateApplyForm />);
    await user.type(screen.getByLabelText(/Your email/i), 'creator@example.com');
    await user.type(screen.getByLabelText(/Your name/i), 'Casey Creator');
    await user.type(screen.getByLabelText(/Audience size/i), '12000');
    await user.selectOptions(screen.getByLabelText(/Primary audience/i), 'Instagram');
    await user.type(screen.getByLabelText(/Why us\?/i), 'GLP-1 coach with 12k audience.');
    await user.click(screen.getByRole('button', { name: /Submit application/i }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Application received/i })).toBeInTheDocument(),
    );
    // Original form fields no longer in the DOM.
    expect(screen.queryByLabelText(/Your email/i)).not.toBeInTheDocument();
    // Success body echoes the submitted email.
    expect(screen.getByText(/creator@example\.com/)).toBeInTheDocument();
  });

  it('T6 — native <select> has exactly 6 options matching D-05 enum', () => {
    render(<AffiliateApplyForm />);
    const select = screen.getByLabelText(/Primary audience/i) as HTMLSelectElement;
    const options = within(select).getAllByRole('option');
    // 1 placeholder ("Choose one") + 6 real options.
    expect(options).toHaveLength(7);
    const realLabels = options.slice(1).map((o) => o.textContent);
    expect(realLabels).toEqual([
      'Instagram',
      'TikTok',
      'YouTube',
      'Newsletter',
      'Coaching',
      'Other',
    ]);
  });
});

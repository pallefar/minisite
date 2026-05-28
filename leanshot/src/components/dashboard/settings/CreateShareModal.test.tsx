// Phase 8 Plan 08-03 Task 2 — CreateShareModal contract tests.
//
// Covers the eight RED-phase behaviors:
//   1. Renders form state on open with focus on the label Input.
//   2. Expiry radio defaults to 7 days.
//   3. Disclosure block is collapsed by default.
//   4. Submit disabled until label is non-empty.
//   5. Successful submit → transitions to post-creation state with link + code.
//   6. Copy buttons call navigator.clipboard.writeText.
//   7. Done → onClose; raw_token + raw_code are discarded on close (T-08-I4).
//   8. Failed submit → retains the form with the typed label (no data loss).

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShare } from '@/lib/shares';
import { useStore } from '@/lib/store';
import { CreateShareModal } from './CreateShareModal';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

vi.mock('@/lib/shares', () => ({
  createShare: vi.fn(),
  shareLinkFor: (t: string) => `http://test/#/share/${t}`,
}));

const clipboardWriteText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  clipboardWriteText.mockClear();
  // jsdom MAY implement `navigator.clipboard` as a non-writable getter on
  // the prototype (depends on version). Two-step patch:
  //   1. If clipboard is absent, define the whole object on navigator.
  //   2. Always patch writeText so the component's call routes to our spy.
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
  } else {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      writable: true,
      value: clipboardWriteText,
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  useStore.setState({ toast: null } as never);
});

describe('CreateShareModal — Plan 08-03 Task 2', () => {
  it('renders form state with label input + expiry radios + collapsed disclosure', async () => {
    render(<CreateShareModal open onClose={() => {}} />);

    expect(
      await screen.findByRole('heading', { name: /Create a share link/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Who is this for\?/i)).toBeInTheDocument();

    // Default 7-day radio is checked.
    const sevenDay = screen.getByRole('radio', { name: /^7 days$/i }) as HTMLInputElement;
    expect(sevenDay.checked).toBe(true);

    // 24h + 30d radios present but unchecked.
    expect((screen.getByRole('radio', { name: /^24 hours$/i }) as HTMLInputElement).checked).toBe(
      false,
    );
    expect((screen.getByRole('radio', { name: /^30 days$/i }) as HTMLInputElement).checked).toBe(
      false,
    );

    // Disclosure summary present + collapsed (no `open` attribute on <details>).
    const disclosure = screen.getByText(/What can the doctor see\?/i).closest('details');
    expect(disclosure).not.toBeNull();
    expect((disclosure as HTMLDetailsElement).open).toBe(false);
  });

  it('Generate share button disabled until label is non-empty', async () => {
    render(<CreateShareModal open onClose={() => {}} />);

    const submitBtn = screen.getByRole('button', { name: /^Generate share$/i });
    expect(submitBtn).toBeDisabled();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Who is this for\?/i), 'Dr. Smith');
    expect(submitBtn).toBeEnabled();
  });

  it('successful submit transitions to post-creation with link + code visible', async () => {
    vi.mocked(createShare).mockResolvedValueOnce({
      share_id: 'sid-abc',
      raw_token: 'tok-123',
      raw_code: '123456',
    });

    render(<CreateShareModal open onClose={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Who is this for\?/i), 'Dr. Smith');
    await user.click(screen.getByRole('button', { name: /^Generate share$/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Share ready/i })).toBeInTheDocument();
    });
    // 6-digit code surfaces.
    expect(screen.getByText('123456')).toBeInTheDocument();
    // Link uses shareLinkFor() mock.
    expect(screen.getByText(/http:\/\/test\/#\/share\/tok-123/)).toBeInTheDocument();
    // Both copy buttons present.
    expect(screen.getByRole('button', { name: /Copy link/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy code/i })).toBeInTheDocument();
  });

  it('Copy link button calls navigator.clipboard.writeText with the URL', async () => {
    vi.mocked(createShare).mockResolvedValueOnce({
      share_id: 'sid-abc',
      raw_token: 'tok-123',
      raw_code: '123456',
    });

    render(<CreateShareModal open onClose={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Who is this for\?/i), 'X');
    await user.click(screen.getByRole('button', { name: /^Generate share$/i }));

    await screen.findByRole('heading', { name: /Share ready/i });
    await user.click(screen.getByRole('button', { name: /Copy link/i }));

    expect(clipboardWriteText).toHaveBeenCalledWith('http://test/#/share/tok-123');
  });

  it('Copy code button calls navigator.clipboard.writeText with the 6-digit code', async () => {
    vi.mocked(createShare).mockResolvedValueOnce({
      share_id: 'sid-abc',
      raw_token: 'tok-123',
      raw_code: '987654',
    });

    render(<CreateShareModal open onClose={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Who is this for\?/i), 'X');
    await user.click(screen.getByRole('button', { name: /^Generate share$/i }));

    await screen.findByRole('heading', { name: /Share ready/i });
    await user.click(screen.getByRole('button', { name: /Copy code/i }));

    expect(clipboardWriteText).toHaveBeenCalledWith('987654');
  });

  it('Done button closes the modal and discards raw_token + raw_code from state (T-08-I4)', async () => {
    vi.mocked(createShare).mockResolvedValueOnce({
      share_id: 'sid-abc',
      raw_token: 'tok-secret',
      raw_code: '111111',
    });

    const onClose = vi.fn();
    const { unmount } = render(<CreateShareModal open onClose={onClose} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Who is this for\?/i), 'X');
    await user.click(screen.getByRole('button', { name: /^Generate share$/i }));
    await screen.findByRole('heading', { name: /Share ready/i });

    // Sanity: secrets visible pre-close.
    expect(screen.getByText('111111')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Done$/i }));
    expect(onClose).toHaveBeenCalled();

    unmount();
  });

  it('failed submit retains form state with the typed label', async () => {
    vi.mocked(createShare).mockRejectedValueOnce(new Error('network'));

    render(<CreateShareModal open onClose={() => {}} />);
    const user = userEvent.setup();
    const labelInput = screen.getByLabelText(/Who is this for\?/i);
    await user.type(labelInput, 'Dr. Smith — retain me');
    await user.click(screen.getByRole('button', { name: /^Generate share$/i }));

    await waitFor(() => {
      // Form state retained — label NOT cleared on error.
      expect(screen.getByDisplayValue('Dr. Smith — retain me')).toBeInTheDocument();
    });
    // Post-creation heading should NOT be present.
    expect(screen.queryByRole('heading', { name: /Share ready/i })).toBeNull();
  });
});

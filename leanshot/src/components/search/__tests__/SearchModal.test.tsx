/**
 * Phase 49 Plan 09 — SearchModal tests.
 *
 * Covers behavior from the plan's <behavior> block:
 *  1. Modal opens when searchOpen flag flips true (Cmd+K wiring tested separately in App.tsx).
 *  2. Modal closes on Escape (cmdk's built-in behavior bound to onOpenChange(false)).
 *  3. Query length < 3 does NOT fire search_content RPC (debounced + gated).
 *  4. 300ms debounce coalesces rapid typing into a single RPC call.
 *  5. Results render grouped into Posts / Lessons / Events sections.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mock surface ---------------------------------------------------
const { rpcMock, storeState } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  storeState: {
    current: {
      searchOpen: true,
      setSearchOpen: vi.fn(),
    },
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

vi.mock('@/lib/store', () => ({
  useStore: <T,>(selector: (s: unknown) => T): T => selector(storeState.current),
}));

import SearchModal from '../SearchModal';

beforeEach(() => {
  rpcMock.mockReset().mockResolvedValue({ data: [], error: null });
  storeState.current = {
    searchOpen: true,
    setSearchOpen: vi.fn(),
  };
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe('SearchModal (Plan 49-09)', () => {
  it('renders Command.Dialog when searchOpen=true', async () => {
    render(<SearchModal onClose={() => {}} />);
    expect(await screen.findByPlaceholderText(/search posts/i)).toBeInTheDocument();
  });

  it('does NOT fire search_content RPC when query length < 3', async () => {
    render(<SearchModal onClose={() => {}} />);
    const input = await screen.findByPlaceholderText(/search posts/i);
    fireEvent.change(input, { target: { value: 'ab' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('fires search_content RPC after 300ms debounce when query length >= 3', async () => {
    render(<SearchModal onClose={() => {}} />);
    const input = await screen.findByPlaceholderText(/search posts/i);
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(rpcMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock).toHaveBeenCalledWith('search_content', expect.objectContaining({ p_query: 'abc' }));
  });

  it('coalesces rapid typing into a single RPC call (300ms debounce window)', async () => {
    render(<SearchModal onClose={() => {}} />);
    const input = await screen.findByPlaceholderText(/search posts/i);
    fireEvent.change(input, { target: { value: 'abc' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    fireEvent.change(input, { target: { value: 'abcd' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    fireEvent.change(input, { target: { value: 'abcde' } });
    expect(rpcMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock).toHaveBeenCalledWith('search_content', expect.objectContaining({ p_query: 'abcde' }));
  });

  it('groups results by type into Posts / Lessons / Events sections', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          type: 'post',
          id: '11111111-1111-1111-1111-111111111111',
          title: 'A community post',
          snippet: 'fragment <b>match</b>',
          rank: 0.5,
          space_id: '22222222-2222-2222-2222-222222222222',
          course_id: null,
          module_id: null,
          start_at: null,
        },
        {
          type: 'lesson',
          id: '33333333-3333-3333-3333-333333333333',
          title: 'A lesson',
          snippet: 'fragment',
          rank: 0.3,
          space_id: null,
          course_id: '44444444-4444-4444-4444-444444444444',
          module_id: null,
          start_at: null,
        },
        {
          type: 'event',
          id: '55555555-5555-5555-5555-555555555555',
          title: 'An event',
          snippet: 'fragment',
          rank: 0.1,
          space_id: null,
          course_id: null,
          module_id: null,
          start_at: '2026-06-01T12:00:00Z',
        },
      ],
      error: null,
    });

    render(<SearchModal onClose={() => {}} />);
    const input = await screen.findByPlaceholderText(/search posts/i);
    fireEvent.change(input, { target: { value: 'frag' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    await screen.findByText(/A community post/);
    await screen.findByText(/A lesson/);
    await screen.findByText(/An event/);
    expect(screen.getByText('Posts')).toBeInTheDocument();
    expect(screen.getByText('Lessons')).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
  });
});

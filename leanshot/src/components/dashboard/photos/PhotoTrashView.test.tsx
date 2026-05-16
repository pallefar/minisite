/**
 * Phase 23 Plan 23-04 (DEBT-03) — unit tests for PhotoTrashView.
 *
 * Tests:
 *   1. open=false renders nothing (modal not mounted)
 *   2. Fetches + renders trashed photos on open (Supabase mock)
 *   3. Restore button calls restorePhoto + removes photo from view
 *   4. Delete-now button calls deletePhotoPermanently + removes photo from view
 *   5. Empty state when no trashed photos
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted spies
// ---------------------------------------------------------------------------

const { mockRestorePhoto, mockDeletePhotoPermanently, mockSupabaseChain } = vi.hoisted(() => {
  const mockRestorePhoto = vi.fn().mockResolvedValue(undefined);
  const mockDeletePhotoPermanently = vi.fn().mockResolvedValue(undefined);

  // Build a chainable Supabase mock for .from().select().not().order()
  const mockOrder = vi.fn().mockResolvedValue({ data: [], error: null });
  const mockNot = vi.fn().mockReturnValue({ order: mockOrder });
  const mockSelect = vi.fn().mockReturnValue({ not: mockNot });
  const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

  return {
    mockRestorePhoto,
    mockDeletePhotoPermanently,
    mockSupabaseChain: { mockFrom, mockSelect, mockNot, mockOrder },
  };
});

vi.mock('@/lib/photo-trash', () => ({
  restorePhoto: mockRestorePhoto,
  deletePhotoPermanently: mockDeletePhotoPermanently,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockSupabaseChain.mockFrom,
  },
}));

// photo-url returns a deterministic URL in tests
vi.mock('@/lib/photo-url', () => ({
  storageTransformUrl: (path: string) => `https://cdn.example.com/${path}`,
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { PhotoTrashView } from './PhotoTrashView';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePhoto = (id: string, trashed_at = '2026-05-01T00:00:00Z') => ({
  photo_id: id,
  date: '2026-05-01',
  storage_path: `user-1/photos/${id}.jpg`,
  mime_type: 'image/jpeg',
  trashed_at,
  weight: null,
  user_id: 'user-1',
});

function resetChain(data: ReturnType<typeof makePhoto>[] = []): void {
  mockSupabaseChain.mockOrder.mockResolvedValue({ data, error: null });
  mockSupabaseChain.mockNot.mockReturnValue({ order: mockSupabaseChain.mockOrder });
  mockSupabaseChain.mockSelect.mockReturnValue({ not: mockSupabaseChain.mockNot });
  mockSupabaseChain.mockFrom.mockReturnValue({ select: mockSupabaseChain.mockSelect });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PhotoTrashView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain([]);
  });

  it('1. renders nothing when open=false (Modal not mounted)', () => {
    const { container } = render(<PhotoTrashView open={false} onClose={vi.fn()} />);
    // AnimatePresence with open=false renders nothing into DOM
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('2. fetches and renders trashed photos when open=true', async () => {
    resetChain([makePhoto('photo-a'), makePhoto('photo-b')]);

    render(<PhotoTrashView open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('photo-trash-grid')).toBeInTheDocument();
    });

    expect(screen.getByTestId('trash-photo-photo-a')).toBeInTheDocument();
    expect(screen.getByTestId('trash-photo-photo-b')).toBeInTheDocument();
  });

  it('3. Restore button calls restorePhoto + removes photo from view', async () => {
    resetChain([makePhoto('photo-c')]);

    render(<PhotoTrashView open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('trash-photo-photo-c')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('restore-btn-photo-c'));

    await waitFor(() => {
      expect(mockRestorePhoto).toHaveBeenCalledWith('photo-c');
    });

    await waitFor(() => {
      expect(screen.queryByTestId('trash-photo-photo-c')).not.toBeInTheDocument();
    });
  });

  it('4. Delete-now button calls deletePhotoPermanently + removes photo from view', async () => {
    resetChain([makePhoto('photo-d')]);

    render(<PhotoTrashView open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('trash-photo-photo-d')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('delete-now-btn-photo-d'));

    await waitFor(() => {
      expect(mockDeletePhotoPermanently).toHaveBeenCalledWith(
        'photo-d',
        'user-1/photos/photo-d.jpg',
      );
    });

    await waitFor(() => {
      expect(screen.queryByTestId('trash-photo-photo-d')).not.toBeInTheDocument();
    });
  });

  it('5. Empty state displayed when no trashed photos', async () => {
    resetChain([]);

    render(<PhotoTrashView open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('No photos in trash')).toBeInTheDocument();
    });
  });
});

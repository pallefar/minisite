/**
 * Phase 23 Plan 23-04 (DEBT-03) — unit tests for photo-trash.ts pure helpers.
 *
 * Tests:
 *   (a) softDeletePhoto passes an ISO timestamp to update({ trashed_at })
 *   (b) restorePhoto passes null to update({ trashed_at })
 *   (c) deletePhotoPermanently calls storage.remove BEFORE db.delete (order)
 *   (d) deletePhotoPermanently continues to db.delete even when storage.remove rejects
 *   (e) all three reject when the db query rejects
 *
 * Mocking strategy: vi.mock('@/lib/supabase') with vi.hoisted() so the mock
 * factory can reference vitest spies that are initialised before hoisting.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted spy factories — must be created with vi.hoisted so they are
// available when the vi.mock factory runs (which is hoisted to top of module).
// ---------------------------------------------------------------------------

const { mockStorageRemove, mockStorageFrom, mockUpdate, mockDelete, mockEq, mockFrom } =
  vi.hoisted(() => {
    const mockEq = vi.fn().mockResolvedValue({ error: null });
    const mockUpdate = vi.fn(() => ({ eq: mockEq }));
    const mockDelete = vi.fn(() => ({ eq: mockEq }));
    const mockFrom = vi.fn(() => ({ update: mockUpdate, delete: mockDelete }));
    const mockStorageRemove = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockStorageFrom = vi.fn(() => ({ remove: mockStorageRemove }));
    return { mockStorageRemove, mockStorageFrom, mockUpdate, mockDelete, mockEq, mockFrom };
  });

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    storage: { from: mockStorageFrom },
  },
}));

// Subject under test (imported AFTER vi.mock registration)
import { softDeletePhoto, restorePhoto, deletePhotoPermanently } from './photo-trash';

// ---------------------------------------------------------------------------
// Reset helpers
// ---------------------------------------------------------------------------

function resetMocks(): void {
  mockFrom.mockClear();
  mockUpdate.mockClear();
  mockDelete.mockClear();
  mockEq.mockClear();
  mockStorageFrom.mockClear();
  mockStorageRemove.mockClear();
  // Restore defaults
  mockEq.mockResolvedValue({ error: null });
  mockStorageRemove.mockResolvedValue({ data: null, error: null });
  // Restore chain returns
  mockUpdate.mockReturnValue({ eq: mockEq });
  mockDelete.mockReturnValue({ eq: mockEq });
  mockFrom.mockReturnValue({ update: mockUpdate, delete: mockDelete });
  mockStorageFrom.mockReturnValue({ remove: mockStorageRemove });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('softDeletePhoto', () => {
  beforeEach(resetMocks);

  it('(a) calls update({ trashed_at: <ISO string> }) with a valid ISO timestamp', async () => {
    const before = Date.now();
    await softDeletePhoto('photo-uuid-1');
    const after = Date.now();

    expect(mockFrom).toHaveBeenCalledWith('photos');
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    const updateArg = mockUpdate.mock.calls[0]![0] as { trashed_at?: string };
    expect(typeof updateArg.trashed_at).toBe('string');

    const ts = new Date(updateArg.trashed_at!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);

    expect(mockEq).toHaveBeenCalledWith('photo_id', 'photo-uuid-1');
  });

  it('(e-soft) rejects when db update returns an error', async () => {
    mockEq.mockResolvedValueOnce({ error: { message: 'db write failed' } });
    await expect(softDeletePhoto('photo-uuid-2')).rejects.toThrow('softDeletePhoto failed');
  });
});

describe('restorePhoto', () => {
  beforeEach(resetMocks);

  it('(b) calls update({ trashed_at: null }) to clear the soft-delete marker', async () => {
    await restorePhoto('photo-uuid-3');

    expect(mockFrom).toHaveBeenCalledWith('photos');
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    const updateArg = mockUpdate.mock.calls[0]![0] as { trashed_at?: null };
    expect(updateArg.trashed_at).toBeNull();

    expect(mockEq).toHaveBeenCalledWith('photo_id', 'photo-uuid-3');
  });

  it('(e-restore) rejects when db update returns an error', async () => {
    mockEq.mockResolvedValueOnce({ error: { message: 'db write failed' } });
    await expect(restorePhoto('photo-uuid-4')).rejects.toThrow('restorePhoto failed');
  });
});

describe('deletePhotoPermanently', () => {
  beforeEach(resetMocks);

  it('(c) calls storage.remove BEFORE db.delete, in that order', async () => {
    const callOrder: string[] = [];

    mockStorageRemove.mockImplementation(() => {
      callOrder.push('storage.remove');
      return Promise.resolve({ data: null, error: null });
    });

    const deleteEqMock = vi.fn().mockImplementation(() => {
      callOrder.push('db.delete');
      return Promise.resolve({ error: null });
    });
    mockDelete.mockReturnValueOnce({ eq: deleteEqMock });

    await deletePhotoPermanently('photo-uuid-5', 'user-1/photos/photo-uuid-5.jpg');

    expect(callOrder).toEqual(['storage.remove', 'db.delete']);
    expect(mockStorageFrom).toHaveBeenCalledWith('photos');
    expect(mockStorageRemove).toHaveBeenCalledWith(['user-1/photos/photo-uuid-5.jpg']);
    expect(mockFrom).toHaveBeenCalledWith('photos');
    expect(deleteEqMock).toHaveBeenCalledWith('photo_id', 'photo-uuid-5');
  });

  it('(d) continues to db.delete even when storage.remove rejects', async () => {
    mockStorageRemove.mockRejectedValueOnce(new Error('storage bucket error'));

    const deleteEqMock = vi.fn().mockResolvedValue({ error: null });
    mockDelete.mockReturnValueOnce({ eq: deleteEqMock });

    // Must NOT throw despite storage failure
    await expect(
      deletePhotoPermanently('photo-uuid-6', 'user-1/photos/photo-uuid-6.jpg'),
    ).resolves.not.toThrow();

    // DB delete must still have been called
    expect(deleteEqMock).toHaveBeenCalledWith('photo_id', 'photo-uuid-6');
  });

  it('(e-permanent) rejects when db.delete returns an error', async () => {
    const deleteEqMock = vi.fn().mockResolvedValue({ error: { message: 'db delete failed' } });
    mockDelete.mockReturnValueOnce({ eq: deleteEqMock });

    await expect(
      deletePhotoPermanently('photo-uuid-7', 'user-1/photos/photo-uuid-7.jpg'),
    ).rejects.toThrow('DB delete failed');
  });
});

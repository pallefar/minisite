/**
 * Phase 6 06-04 — photo-queue.ts unit tests.
 *
 * Uses `fake-indexeddb/auto` to install a real IDB shim into globalThis so
 * the module-under-test's `openDB` call resolves without a browser.
 *
 * NOTE on Blob fidelity: `fake-indexeddb` performs a structured-clone of
 * stored values, and jsdom's Blob impl is not fully structured-clone-able
 * — Blob instances round-trip as empty objects. We therefore assert the
 * KEY CONTRACT (presence / deletion / listing / clearing) rather than
 * byte-for-byte payload fidelity. Full payload fidelity is exercised in
 * the Playwright e2e suite which runs in a real browser.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetForTests,
  clearAllPhotoBlobs,
  deletePhotoBlob,
  getPhotoBlob,
  listPhotoBlobKeys,
  putPhotoBlob,
} from './photo-queue';

function makeBlob(text: string): Blob {
  return new Blob([text], { type: 'image/jpeg' });
}

beforeEach(async () => {
  await _resetForTests();
});

describe('photo-queue', () => {
  it('putPhotoBlob then getPhotoBlob returns a value (presence contract)', async () => {
    const blob = makeBlob('hello-photo');
    await putPhotoBlob('k1', blob);
    const fetched = await getPhotoBlob('k1');
    expect(fetched).toBeDefined();
  });

  it('deletePhotoBlob removes the entry; subsequent get returns undefined', async () => {
    await putPhotoBlob('k2', makeBlob('x'));
    await deletePhotoBlob('k2');
    const fetched = await getPhotoBlob('k2');
    expect(fetched).toBeUndefined();
  });

  it('listPhotoBlobKeys returns array of stored keys', async () => {
    await putPhotoBlob('a', makeBlob('1'));
    await putPhotoBlob('b', makeBlob('2'));
    await putPhotoBlob('c', makeBlob('3'));
    const keys = await listPhotoBlobKeys();
    expect(keys.sort()).toEqual(['a', 'b', 'c']);
  });

  it('clearAllPhotoBlobs empties the store (T-06-04-04 SIGNED_OUT cleanup)', async () => {
    await putPhotoBlob('a', makeBlob('1'));
    await putPhotoBlob('b', makeBlob('2'));
    await clearAllPhotoBlobs();
    const keys = await listPhotoBlobKeys();
    expect(keys).toEqual([]);
  });

  it('getPhotoBlob for an unknown key returns undefined (not a thrown error)', async () => {
    const fetched = await getPhotoBlob('never-stored');
    expect(fetched).toBeUndefined();
  });

  it('overwriting an existing key keeps a single entry (listKeys.length stays 1)', async () => {
    await putPhotoBlob('k', makeBlob('first'));
    await putPhotoBlob('k', makeBlob('second-longer'));
    const keys = await listPhotoBlobKeys();
    expect(keys.length).toBe(1);
    expect(keys[0]).toBe('k');
  });

  it('clearAllPhotoBlobs swallows internal errors (best-effort cleanup)', async () => {
    // Even after _resetForTests deletes the db, clearAllPhotoBlobs must not
    // throw — it re-opens the db on demand and clears it.
    await expect(clearAllPhotoBlobs()).resolves.toBeUndefined();
  });
});

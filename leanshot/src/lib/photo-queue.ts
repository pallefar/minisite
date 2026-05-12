/**
 * Phase 6 D-08 — IndexedDB photo blob queue.
 *
 * SYNC-04 substrate split: pendingOps (table='photos', op='upload') still
 * lives in localStorage with all other queue ops, but the photo Blob payload
 * lives in IndexedDB under `leanshot_photo_queue/blobs` keyed by photo_id.
 * Rationale: a 2 MB compressed JPEG in localStorage would exhaust the 5–10 MB
 * quota in a single capture session (RESEARCH §3, Pitfall 4).
 *
 * T-06-04-04 mitigation: `clearAllPhotoBlobs()` is fired on SIGNED_OUT BEFORE
 * `clearUserDataSlices()` so a second user signing in on the same browser
 * does not inherit the prior user's photo bytes.
 *
 * Private-mode browsers: every IDB call is wrapped at the caller boundary.
 * `clearAllPhotoBlobs` swallows errors (best-effort cleanup); the
 * put/get/delete/listKeys functions propagate so callers can handle the
 * "queue unusable on this device — fall back to base64-in-Zustand" path
 * (Pattern B). Pre-launch: callers log + toast; deferred work could disable
 * the photo capture button entirely.
 */
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'leanshot_photo_queue';
const STORE_NAME = 'blobs';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME); // out-of-line keys
        }
      },
    });
  }
  return dbPromise;
}

export async function putPhotoBlob(key: string, blob: Blob): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, blob, key);
}

export async function getPhotoBlob(key: string): Promise<Blob | undefined> {
  const db = await getDb();
  return (await db.get(STORE_NAME, key)) as Blob | undefined;
}

export async function deletePhotoBlob(key: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, key);
}

export async function listPhotoBlobKeys(): Promise<string[]> {
  const db = await getDb();
  const keys = await db.getAllKeys(STORE_NAME);
  return keys as string[];
}

/** Sign-out cleanup. T-06-04-04 mitigation. Best-effort: swallows errors. */
export async function clearAllPhotoBlobs(): Promise<void> {
  try {
    const db = await getDb();
    await db.clear(STORE_NAME);
  } catch (e) {
    console.error('[leanshot] photo-queue clear failed', e);
  }
}

/**
 * Test-only — close + reset module-level dbPromise so each test gets a clean
 * db handle. Also deletes the underlying IndexedDB so state cannot leak
 * between tests.
 * @internal
 */
export async function _resetForTests(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      /* noop */
    }
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

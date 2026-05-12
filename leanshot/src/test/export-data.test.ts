/**
 * Phase 7 Plan 07-06 — unit tests for the pure export module.
 *
 * Covers:
 *   1. Top-level shape — meta + local, with the exact 22-key partialize allow-list.
 *   2. Whitelist regression (Threat T-07-06-02) — passing a rogue
 *      `sb_leanshot_auth_token` / `anthropic_key` does NOT leak into output.
 *   3. Cloud override — cloudExtras arrays replace local arrays.
 *   4. Audit summary — `meta.audit_summary` reflects input; NO `audit_logs[]`.
 *   5. PDF cover + autoTable section count + no addImage.
 *   6. PDF photo summary text format (with photos + empty array).
 */
import type { jsPDF } from 'jspdf';
import type autoTableFn from 'jspdf-autotable';
import { describe, expect, it, vi } from 'vitest';
import {
  EXPORT_WHITELIST_KEYS,
  buildJsonExport,
  buildPdfDoc,
  type AuditSummary,
  type CloudExtras,
} from '@/lib/export-data';
import type { PersistedState } from '@/lib/storage';

function makeState(overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    user: {
      name: 'TestUser',
      units: 'metric',
      goalWeight: 80,
    } as unknown as PersistedState['user'],
    injections: [],
    symptoms: [],
    weights: [],
    measurements: [],
    meals: [],
    water: {},
    foodNoise: {},
    workouts: [],
    steps: {},
    supplements: {},
    mood: [],
    sleep: [],
    nsvs: [],
    photos: [],
    vials: [],
    aiHistory: [],
    costs: [],
    acknowledgedDisclaimer: 'v1',
    pendingOps: [],
    verificationBannerDismissedUntil: undefined,
    migration_state: null,
    ...overrides,
  };
}

describe('buildJsonExport', () => {
  it('returns the exact 22 partialize keys under `local` + `meta` at top level', () => {
    const out = buildJsonExport(makeState(), null, null);
    expect(Object.keys(out).sort()).toEqual(['local', 'meta']);
    const localKeys = Object.keys(out.local).sort();
    expect(localKeys).toEqual([...EXPORT_WHITELIST_KEYS].sort());
    expect(localKeys.length).toBe(22);
    expect(out.meta.exportVersion).toBe(1);
    expect(out.meta.source).toBe('local-only');
  });

  it('whitelist regression — rogue keys (sb_leanshot_auth_token, anthropic_key) NEVER appear in output', () => {
    // Forge a state object with extra keys that would leak the supabase session
    // and a legacy anthropic key. The function MUST drop them on the floor —
    // explicit-enumeration semantics, not Object.keys pass-through.
    const rogueState = {
      ...makeState(),
      sb_leanshot_auth_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ROGUE',
      'sb-leanshot-auth-token': 'eyJ...also-rogue',
      leanshot_anthropic_key: 'sk-ant-LEAKED-KEY',
      __rawLocalStorage: 'should-never-appear',
    } as unknown as PersistedState;

    const out = buildJsonExport(rogueState, null, null);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('sb_leanshot_auth_token');
    expect(serialized).not.toContain('sb-leanshot-auth-token');
    expect(serialized).not.toContain('leanshot_anthropic_key');
    expect(serialized).not.toContain('sk-ant-LEAKED-KEY');
    expect(serialized).not.toContain('__rawLocalStorage');
  });

  it('cloudExtras arrays REPLACE local arrays for entities present; missing entities pass through local', () => {
    const state = makeState({
      injections: [{ id: 'local-1' }] as unknown as PersistedState['injections'],
      weights: [{ id: 'local-w-1' }] as unknown as PersistedState['weights'],
    });
    const cloud: CloudExtras = {
      injections: [{ id: 'cloud-1' }, { id: 'cloud-2' }],
      // weights NOT provided — local must pass through.
    };
    const out = buildJsonExport(state, cloud, null);
    expect(out.local.injections).toHaveLength(2);
    expect((out.local.injections[0] as { id: string }).id).toBe('cloud-1');
    expect(out.local.weights).toHaveLength(1);
    expect((out.local.weights[0] as { id: string }).id).toBe('local-w-1');
    expect(out.meta.source).toBe('local+cloud');
  });

  it('audit summary lives under meta.audit_summary; NO `audit_logs[]` array anywhere in output', () => {
    const audit: AuditSummary = {
      window: '13mo',
      inserts: 142,
      updates: 31,
      deletes: 5,
      initiated_count: 0,
      finalized_count: 0,
    };
    const out = buildJsonExport(makeState(), null, audit);
    expect(out.meta.audit_summary).toEqual(audit);
    expect(out.meta.source).toBe('local+cloud');
    // Crucially: no audit_logs array on local.* or anywhere else.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('"audit_logs"');
    expect((out.local as unknown as Record<string, unknown>).audit_logs).toBeUndefined();
  });

  it('ai_messages_count from cloud lands under meta, not local.aiHistory', () => {
    const out = buildJsonExport(makeState(), { ai_messages_count: 42 }, null);
    expect(out.meta.ai_messages_count).toBe(42);
    expect(out.local.aiHistory).toEqual([]); // local aiHistory unchanged
  });
});

describe('buildPdfDoc', () => {
  /** Build a fake jsPDF constructor + autoTable that record calls. */
  function makeJsPDFMock() {
    const calls: { method: string; args: unknown[] }[] = [];
    const doc = {
      setFontSize: vi.fn((n: number) => {
        calls.push({ method: 'setFontSize', args: [n] });
        return doc;
      }),
      text: vi.fn((txt: unknown, x: unknown, y: unknown, opts?: unknown) => {
        calls.push({ method: 'text', args: [txt, x, y, opts] });
        return doc;
      }),
      addImage: vi.fn(() => {
        calls.push({ method: 'addImage', args: [] });
        return doc;
      }),
      save: vi.fn(),
      lastAutoTable: { finalY: 200 },
    };
    function Ctor() {
      return doc;
    }
    return { Ctor: Ctor as unknown as typeof jsPDF, doc, calls };
  }

  it('cover page renders title + email + export date; autoTable called for at least 5 entity tables; addImage NEVER called', () => {
    const { Ctor, doc, calls } = makeJsPDFMock();
    const autoTableCalls: unknown[] = [];
    const autoTable = vi.fn((_doc: unknown, opts: unknown) => {
      autoTableCalls.push(opts);
      // After each table, advance the cursor.
      doc.lastAutoTable = { finalY: (doc.lastAutoTable.finalY ?? 0) + 50 };
    });

    const payload = buildJsonExport(
      makeState({
        injections: [
          { logged_at: '2026-05-10', site: 'thigh-l', medication: 'ozempic', dose: '0.5' },
        ] as unknown as PersistedState['injections'],
        weights: [{ date: '2026-05-10', weight: 81 }] as unknown as PersistedState['weights'],
        photos: [
          { takenAt: '2026-05-01' },
          { takenAt: '2026-05-09' },
        ] as unknown as PersistedState['photos'],
      }),
      null,
      {
        window: '13mo',
        inserts: 5,
        updates: 1,
        deletes: 0,
        initiated_count: 0,
        finalized_count: 0,
      },
    );

    buildPdfDoc(Ctor, autoTable as unknown as typeof autoTableFn, payload);

    // Title text appeared on cover.
    const titleCalls = calls.filter(
      (c) => c.method === 'text' && c.args[0] === 'LeanShot Health Export',
    );
    expect(titleCalls.length).toBeGreaterThanOrEqual(1);

    // Name field appears.
    const nameCalls = calls.filter(
      (c) =>
        c.method === 'text' &&
        typeof c.args[0] === 'string' &&
        (c.args[0] as string).startsWith('Name: '),
    );
    expect(nameCalls.length).toBeGreaterThanOrEqual(1);

    // Export date appears.
    const dateCalls = calls.filter(
      (c) =>
        c.method === 'text' &&
        typeof c.args[0] === 'string' &&
        (c.args[0] as string).startsWith('Exported: '),
    );
    expect(dateCalls.length).toBeGreaterThanOrEqual(1);

    // ≥ 5 autoTable invocations (profile + injections + weights + measurements + meals + ... = many).
    expect(autoTable.mock.calls.length).toBeGreaterThanOrEqual(5);

    // addImage NEVER called — T-07-06-01.
    expect(doc.addImage).not.toHaveBeenCalled();
  });

  it('photo summary text matches "N photos · earliest YYYY-MM-DD · latest YYYY-MM-DD" pattern with ≥1 photo; "No photos" when empty', () => {
    // Case A: 2 photos with dates.
    const { Ctor: CtorA, calls: callsA } = makeJsPDFMock();
    const autoTableA = vi.fn();
    const payloadA = buildJsonExport(
      makeState({
        photos: [
          { takenAt: '2026-04-15' },
          { takenAt: '2026-05-09' },
          { takenAt: '2026-01-01' },
        ] as unknown as PersistedState['photos'],
      }),
      null,
      null,
    );
    buildPdfDoc(CtorA, autoTableA as unknown as typeof autoTableFn, payloadA);
    const photoLines = callsA
      .filter((c) => c.method === 'text' && typeof c.args[0] === 'string')
      .map((c) => c.args[0] as string);
    const matchedLine = photoLines.find((line) =>
      /\d+ photos · earliest \d{4}-\d{2}-\d{2} · latest \d{4}-\d{2}-\d{2}/.test(line),
    );
    expect(matchedLine).toBeDefined();
    expect(matchedLine).toContain('3 photos');
    expect(matchedLine).toContain('earliest 2026-01-01');
    expect(matchedLine).toContain('latest 2026-05-09');

    // Case B: empty photos array → "No photos".
    const { Ctor: CtorB, calls: callsB } = makeJsPDFMock();
    const autoTableB = vi.fn();
    const payloadB = buildJsonExport(makeState({ photos: [] }), null, null);
    buildPdfDoc(CtorB, autoTableB as unknown as typeof autoTableFn, payloadB);
    const allTextB = callsB
      .filter((c) => c.method === 'text' && typeof c.args[0] === 'string')
      .map((c) => c.args[0] as string);
    expect(allTextB).toContain('No photos');
  });
});

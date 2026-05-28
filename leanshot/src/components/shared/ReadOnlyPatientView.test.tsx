/**
 * Phase 10 Plan 10-05 Task 2 — TDD RED: ReadOnlyPatientView behavior tests.
 *
 * Tests:
 * 1. viewerMode='share' renders all 6 sections (no permissionMap → all visible)
 * 2. viewerMode='clinic' + full permissionMap renders all 6 sections
 * 3. viewerMode='clinic' + permissionMap.canViewPhotos=false skips Photos section
 * 4. onSectionMount fires once per visible section on mount; no duplicate fires on re-render
 */

import { act, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ReadOnlyPermissionMap, SnapshotData } from '@/types/snapshot';
import { ReadOnlyPatientView } from './ReadOnlyPatientView';

// ─────────────────────────────────────────────────────────────────────────────
// Fixture
// ─────────────────────────────────────────────────────────────────────────────

function buildSnapshot(overrides: Partial<SnapshotData> = {}): SnapshotData {
  return {
    patient_user_id: 'u-1',
    display_name: 'Alice T.',
    injections: [
      { id: 'inj-1', dose_mg: 0.5, site: 'abdomen', created_at: '2024-01-01T10:00:00Z' },
    ],
    weights: [{ id: 'w-1', weight_kg: 85.5, recorded_at: '2024-01-01T08:00:00Z' }],
    symptoms: [{ id: 's-1', name: 'nausea', severity: 3, recorded_at: '2024-01-01T12:00:00Z' }],
    photos: [{ id: 'p-1', storage_path: 'org/user/p-1.jpg', taken_at: '2024-01-01T09:00:00Z' }],
    doctor_report: { generated_at: '2024-01-01T10:00:00Z', markdown: '# Report' },
    viewer_context: 'share',
    ...overrides,
  };
}

const fullPermissionMap: ReadOnlyPermissionMap = {
  canViewInjections: true,
  canViewWeights: true,
  canViewSymptoms: true,
  canViewPhotos: true,
  canViewDoctorReport: true,
  canViewMeals: true,
  canViewWorkouts: true,
  canViewSupplements: true,
  canViewMood: true,
  canViewSleep: true,
  canViewBreakdown: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ReadOnlyPatientView', () => {
  it('Test 1: viewerMode=share renders all 6 section headings (no permissionMap)', async () => {
    render(
      <Suspense fallback={<div>loading</div>}>
        <ReadOnlyPatientView snapshot={buildSnapshot()} viewerMode="share" />
      </Suspense>,
    );
    await act(async () => {});
    expect(screen.getByRole('heading', { name: 'Drug-level estimate' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent injections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Weight log' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Symptoms' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Body photos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Doctor report' })).toBeInTheDocument();
  });

  it('Test 2: viewerMode=clinic + full permissionMap renders all 6 sections', async () => {
    render(
      <Suspense fallback={<div>loading</div>}>
        <ReadOnlyPatientView
          snapshot={buildSnapshot({ viewer_context: 'clinic' })}
          viewerMode="clinic"
          permissionMap={fullPermissionMap}
        />
      </Suspense>,
    );
    await act(async () => {});
    expect(screen.getByRole('heading', { name: 'Drug-level estimate' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent injections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Weight log' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Symptoms' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Body photos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Doctor report' })).toBeInTheDocument();
  });

  it('Test 3: viewerMode=clinic + canViewPhotos=false skips Photos section (D-12 absence rule)', async () => {
    const permMapNoPhotos: ReadOnlyPermissionMap = {
      ...fullPermissionMap,
      canViewPhotos: false,
    };
    render(
      <Suspense fallback={<div>loading</div>}>
        <ReadOnlyPatientView
          snapshot={buildSnapshot({ viewer_context: 'clinic' })}
          viewerMode="clinic"
          permissionMap={permMapNoPhotos}
        />
      </Suspense>,
    );
    await act(async () => {});
    // Other sections present
    expect(screen.getByRole('heading', { name: 'Recent injections' })).toBeInTheDocument();
    // Photos completely absent (no heading, no placeholder)
    expect(screen.queryByRole('heading', { name: 'Body photos' })).not.toBeInTheDocument();
  });

  it('Test 4: onSectionMount fires once per visible section; no duplicate fires on re-render', async () => {
    const onSectionMount = vi.fn();
    const { rerender } = render(
      <Suspense fallback={<div>loading</div>}>
        <ReadOnlyPatientView
          snapshot={buildSnapshot()}
          viewerMode="share"
          onSectionMount={onSectionMount}
        />
      </Suspense>,
    );
    await act(async () => {});
    // All 6 sections should have fired once each
    expect(onSectionMount).toHaveBeenCalledTimes(6);
    const sectionNames = onSectionMount.mock.calls.map((c) => c[0]);
    expect(sectionNames).toContain('chart');
    expect(sectionNames).toContain('injections');
    expect(sectionNames).toContain('weights');
    expect(sectionNames).toContain('symptoms');
    expect(sectionNames).toContain('photos');
    expect(sectionNames).toContain('doctor_report');

    // Re-render should NOT fire additional onMount calls (useRef guard)
    rerender(
      <Suspense fallback={<div>loading</div>}>
        <ReadOnlyPatientView
          snapshot={buildSnapshot()}
          viewerMode="share"
          onSectionMount={onSectionMount}
        />
      </Suspense>,
    );
    await act(async () => {});
    expect(onSectionMount).toHaveBeenCalledTimes(6);
  });
});

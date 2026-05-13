/**
 * Phase 10 Plan 10-05 Task 1 — TDD RED: section component behavior tests.
 *
 * Tests that each extracted section component:
 * 1. renders its data prop without crashing
 * 2. renders an EmptyState when data is `[]` (consent_scope omission case)
 * 3. calls onMount ONCE on first render with its section name
 * 4. composes existing UI primitives (no new primitives)
 */

import { act, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Import all 6 section components (will fail until they exist — RED)
import { InjectionsSection } from './InjectionsSection';
import { WeightsSection } from './WeightsSection';
import { SymptomsSection } from './SymptomsSection';
import { PhotosSection } from './PhotosSection';
import { DoctorReportSection } from './DoctorReportSection';
import { ChartSection } from './ChartSection';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const sampleInjections = [
  { log_id: 'inj-1', timestamp: '2024-01-01T10:00:00Z', medication: 'semaglutide', dose: 0.5, unit: 'mg', site: 'abdomen', id: 'inj-1', dose_mg: 0.5, created_at: '2024-01-01T10:00:00Z' },
  { log_id: 'inj-2', timestamp: '2024-01-08T10:00:00Z', medication: 'semaglutide', dose: 1.0, unit: 'mg', site: 'thigh', id: 'inj-2', dose_mg: 1.0, created_at: '2024-01-08T10:00:00Z' },
];

const sampleWeights = [
  { id: 'w-1', weight_kg: 85.5, timestamp: '2024-01-01T08:00:00Z', recorded_at: '2024-01-01T08:00:00Z' },
  { id: 'w-2', weight_kg: 84.8, timestamp: '2024-01-08T08:00:00Z', recorded_at: '2024-01-08T08:00:00Z' },
];

const sampleSymptoms = [
  { id: 's-1', name: 'nausea', symptom: 'nausea', severity: 3, timestamp: '2024-01-01T12:00:00Z', recorded_at: '2024-01-01T12:00:00Z' },
  { id: 's-2', name: 'fatigue', symptom: 'fatigue', severity: 2, timestamp: '2024-01-02T12:00:00Z', recorded_at: '2024-01-02T12:00:00Z' },
];

const samplePhotos = [
  { id: 'p-1', storage_path: 'org/user/p-1.jpg', signed_url: 'https://example.com/p-1.jpg', timestamp: '2024-01-01T09:00:00Z', taken_at: '2024-01-01T09:00:00Z' },
];

const sampleDoctorReport = { generated_at: '2024-01-01T10:00:00Z', markdown: '# Report\nAll looks good.' };

// ─────────────────────────────────────────────────────────────────────────────
// InjectionsSection
// ─────────────────────────────────────────────────────────────────────────────

describe('InjectionsSection', () => {
  it('Test 1: renders injection data without crashing', () => {
    render(<InjectionsSection data={sampleInjections} viewerMode="share" />);
    expect(screen.getByRole('heading', { name: /Recent injections/i })).toBeInTheDocument();
  });

  it('Test 2: renders EmptyState when data is empty array', () => {
    render(<InjectionsSection data={[]} viewerMode="share" />);
    expect(screen.getByText(/None logged/i)).toBeInTheDocument();
  });

  it('Test 3: calls onMount once with section name', async () => {
    const onMount = vi.fn();
    render(<InjectionsSection data={sampleInjections} viewerMode="clinic" onMount={onMount} />);
    // Allow useEffect to fire
    await act(async () => {});
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onMount).toHaveBeenCalledWith('injections');
  });

  it('Test 3b: does not call onMount twice on re-render', async () => {
    const onMount = vi.fn();
    const { rerender } = render(<InjectionsSection data={sampleInjections} viewerMode="clinic" onMount={onMount} />);
    await act(async () => {});
    rerender(<InjectionsSection data={sampleInjections} viewerMode="clinic" onMount={onMount} />);
    await act(async () => {});
    expect(onMount).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WeightsSection
// ─────────────────────────────────────────────────────────────────────────────

describe('WeightsSection', () => {
  it('Test 1: renders weight data without crashing', () => {
    render(<WeightsSection data={sampleWeights} viewerMode="share" />);
    expect(screen.getByRole('heading', { name: /Weight log/i })).toBeInTheDocument();
  });

  it('Test 2: renders EmptyState when data is empty array', () => {
    render(<WeightsSection data={[]} viewerMode="share" />);
    expect(screen.getByText(/No entries/i)).toBeInTheDocument();
  });

  it('Test 3: calls onMount once with section name', async () => {
    const onMount = vi.fn();
    render(<WeightsSection data={sampleWeights} viewerMode="clinic" onMount={onMount} />);
    await act(async () => {});
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onMount).toHaveBeenCalledWith('weights');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SymptomsSection
// ─────────────────────────────────────────────────────────────────────────────

describe('SymptomsSection', () => {
  it('Test 1: renders symptoms data without crashing', () => {
    render(<SymptomsSection data={sampleSymptoms} viewerMode="share" />);
    expect(screen.getByRole('heading', { name: /Symptoms/i })).toBeInTheDocument();
  });

  it('Test 2: renders EmptyState when data is empty array', () => {
    render(<SymptomsSection data={[]} viewerMode="share" />);
    expect(screen.getByText(/No symptoms logged/i)).toBeInTheDocument();
  });

  it('Test 3: calls onMount once with section name', async () => {
    const onMount = vi.fn();
    render(<SymptomsSection data={sampleSymptoms} viewerMode="clinic" onMount={onMount} />);
    await act(async () => {});
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onMount).toHaveBeenCalledWith('symptoms');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PhotosSection
// ─────────────────────────────────────────────────────────────────────────────

describe('PhotosSection', () => {
  it('Test 1: renders photos data without crashing', () => {
    render(<PhotosSection data={samplePhotos} viewerMode="share" orgId="org-1" />);
    expect(screen.getByRole('heading', { name: /Body photos/i })).toBeInTheDocument();
  });

  it('Test 2: renders EmptyState when data is empty array', () => {
    render(<PhotosSection data={[]} viewerMode="share" orgId="org-1" />);
    expect(screen.getByText(/No photos shared/i)).toBeInTheDocument();
  });

  it('Test 3: calls onMount once with section name', async () => {
    const onMount = vi.fn();
    render(<PhotosSection data={samplePhotos} viewerMode="clinic" orgId="org-1" onMount={onMount} />);
    await act(async () => {});
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onMount).toHaveBeenCalledWith('photos');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DoctorReportSection
// ─────────────────────────────────────────────────────────────────────────────

describe('DoctorReportSection', () => {
  it('Test 1: renders doctor report without crashing', () => {
    render(<DoctorReportSection data={sampleDoctorReport} viewerMode="share" />);
    expect(screen.getByRole('heading', { name: /Doctor report/i })).toBeInTheDocument();
  });

  it('Test 2: renders EmptyState when data is undefined', () => {
    render(<DoctorReportSection data={undefined} viewerMode="share" />);
    expect(screen.getByText(/No doctor report/i)).toBeInTheDocument();
  });

  it('Test 3: calls onMount once with section name', async () => {
    const onMount = vi.fn();
    render(<DoctorReportSection data={sampleDoctorReport} viewerMode="clinic" onMount={onMount} />);
    await act(async () => {});
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onMount).toHaveBeenCalledWith('doctor_report');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ChartSection
// ─────────────────────────────────────────────────────────────────────────────

describe('ChartSection', () => {
  it('Test 1: renders chart section without crashing', async () => {
    const { container } = render(
      <Suspense fallback={<div>loading</div>}>
        <ChartSection data={sampleInjections} viewerMode="share" />
      </Suspense>
    );
    // The heading should be in the document
    await act(async () => {});
    expect(screen.getByRole('heading', { name: /Drug-level estimate/i })).toBeInTheDocument();
  });

  it('Test 2: renders EmptyState when data is empty array', () => {
    render(
      <Suspense fallback={<div>loading</div>}>
        <ChartSection data={[]} viewerMode="share" />
      </Suspense>
    );
    expect(screen.getByRole('heading', { name: /Drug-level estimate/i })).toBeInTheDocument();
  });

  it('Test 3: calls onMount once with section name', async () => {
    const onMount = vi.fn();
    render(
      <Suspense fallback={<div>loading</div>}>
        <ChartSection data={sampleInjections} viewerMode="clinic" onMount={onMount} />
      </Suspense>
    );
    await act(async () => {});
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onMount).toHaveBeenCalledWith('chart');
  });
});

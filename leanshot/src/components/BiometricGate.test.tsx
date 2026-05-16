// Phase 16 Plan 16-02 Task 4 — BiometricGate component tests.
//
// Runs under vitest-mobile.config.ts which aliases @capacitor/core +
// @capgo/capacitor-native-biometric to manual mocks. Component tests reuse
// the same `vi.resetModules() + await import()` pattern as Tasks 1-3 so the
// BiometricGate's module-time captures of detectPlatform / authenticateWith
// Biometric see fresh mock configurations per case.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('<BiometricGate />', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    cleanup();
    vi.resetModules();
  });

  async function loadFresh(platform: 'ios' | 'android', authSucceeds: boolean) {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue(platform);
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
    if (authSucceeds) {
      NativeBiometric.verifyIdentity.mockResolvedValue(undefined);
    } else {
      NativeBiometric.verifyIdentity.mockRejectedValue(new Error('cancelled'));
    }
    const { BiometricGate } = await import('./BiometricGate');
    return { BiometricGate, NativeBiometric };
  }

  it('1. iOS + auto-success → onUnlock called once on mount', async () => {
    const { BiometricGate } = await loadFresh('ios', true);
    const onUnlock = vi.fn();
    const onPasswordSubmit = vi.fn(async () => undefined);
    render(<BiometricGate onUnlock={onUnlock} onPasswordSubmit={onPasswordSubmit} />);
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
  });

  it('2. iOS + 3 consecutive failures → password input + "Unlock App" visible', async () => {
    const { BiometricGate } = await loadFresh('ios', false);
    const onUnlock = vi.fn();
    const onPasswordSubmit = vi.fn(async () => undefined);
    render(<BiometricGate onUnlock={onUnlock} onPasswordSubmit={onPasswordSubmit} />);
    // Mount-triggered attempt 1 fails → manual button reveals; click twice more.
    const manualBtn = await screen.findByRole('button', { name: 'Use Face ID' });
    fireEvent.click(manualBtn); // attempt 2
    fireEvent.click(manualBtn); // attempt 3 — should flip to password mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /unlock app/i })).toBeInTheDocument();
    });
    // Password input is present
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('3. Android → manual button label reads "Use Fingerprint" after first failure', async () => {
    const { BiometricGate } = await loadFresh('android', false);
    const onUnlock = vi.fn();
    const onPasswordSubmit = vi.fn(async () => undefined);
    render(<BiometricGate onUnlock={onUnlock} onPasswordSubmit={onPasswordSubmit} />);
    const btn = await screen.findByRole('button', { name: 'Use Fingerprint' });
    expect(btn).toBeInTheDocument();
  });

  it('4. CTA labels are noun-qualified (no bare Cancel/Unlock/Submit)', async () => {
    const { BiometricGate } = await loadFresh('ios', false);
    const onUnlock = vi.fn();
    const onPasswordSubmit = vi.fn(async () => undefined);
    render(<BiometricGate onUnlock={onUnlock} onPasswordSubmit={onPasswordSubmit} />);
    // Wait for the auto-mount failure to surface the manual CTAs.
    await screen.findByRole('button', { name: 'Use Face ID' });
    expect(screen.getByRole('button', { name: 'Use Face ID' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use Password' })).toBeInTheDocument();
    // No bare labels anywhere.
    expect(screen.queryByRole('button', { name: /^Cancel$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Unlock$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Submit$/ })).not.toBeInTheDocument();
  });

  it('5. Password submit invokes onPasswordSubmit with entered value + then onUnlock', async () => {
    const { BiometricGate } = await loadFresh('ios', false);
    const onUnlock = vi.fn();
    const onPasswordSubmit = vi.fn(async () => undefined);
    render(<BiometricGate onUnlock={onUnlock} onPasswordSubmit={onPasswordSubmit} />);
    // Trip 3 failures to enter password mode
    const manualBtn = await screen.findByRole('button', { name: 'Use Face ID' });
    fireEvent.click(manualBtn);
    fireEvent.click(manualBtn);
    const unlockAppBtn = await screen.findByRole('button', { name: /unlock app/i });
    const pwInput = screen.getByLabelText(/password/i) as HTMLInputElement;
    fireEvent.change(pwInput, { target: { value: 'hunter2' } });
    fireEvent.click(unlockAppBtn);
    await waitFor(() => expect(onPasswordSubmit).toHaveBeenCalledWith('hunter2'));
    await waitFor(() => expect(onUnlock).toHaveBeenCalled());
  });

  it('6. Root has role="dialog" + aria-modal="true" (a11y invariant)', async () => {
    const { BiometricGate } = await loadFresh('ios', false);
    const onUnlock = vi.fn();
    const onPasswordSubmit = vi.fn(async () => undefined);
    render(<BiometricGate onUnlock={onUnlock} onPasswordSubmit={onPasswordSubmit} />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
});

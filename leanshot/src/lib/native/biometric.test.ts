// Phase 16 Plan 16-02 Task 3 — unit tests for biometric.ts.
//
// Runs under `vitest-mobile.config.ts` which aliases:
//   - `@capgo/capacitor-native-biometric` → __mocks__/capgo-native-biometric.ts
//   - `@capacitor/core` → __mocks__/capacitor-core.ts (consumed indirectly via
//     biometric.ts → ./platform → @capacitor/core)
//
// We rely on the same vi.resetModules() + re-import pattern from platform.test.ts:
// each case resets, re-imports the mocks, configures their return values, then
// imports biometric.ts so its module-time captures of NativeBiometric and
// detectPlatform see the configured mocks.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('biometric.ts', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('checkBiometric()', () => {
    it("ios + isAvailable=true → 'available'", async () => {
      const { Capacitor } = await import('@capacitor/core');
      Capacitor.getPlatform.mockReturnValue('ios');
      Capacitor.isNativePlatform.mockReturnValue(true);
      const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
      NativeBiometric.isAvailable.mockResolvedValue({
        isAvailable: true,
        biometryType: 'FACE_ID',
      });
      const { checkBiometric } = await import('./biometric');
      await expect(checkBiometric()).resolves.toBe('available');
    });

    it("ios + isAvailable=false → 'unavailable'", async () => {
      const { Capacitor } = await import('@capacitor/core');
      Capacitor.getPlatform.mockReturnValue('ios');
      Capacitor.isNativePlatform.mockReturnValue(true);
      const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
      NativeBiometric.isAvailable.mockResolvedValue({
        isAvailable: false,
        biometryType: 'NONE',
      });
      const { checkBiometric } = await import('./biometric');
      await expect(checkBiometric()).resolves.toBe('unavailable');
    });

    it("ios + throws permission error → 'permission-denied'", async () => {
      const { Capacitor } = await import('@capacitor/core');
      Capacitor.getPlatform.mockReturnValue('ios');
      Capacitor.isNativePlatform.mockReturnValue(true);
      const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
      NativeBiometric.isAvailable.mockRejectedValue(new Error('Permission denied by user'));
      const { checkBiometric } = await import('./biometric');
      await expect(checkBiometric()).resolves.toBe('permission-denied');
    });

    it("ios + throws other error → 'unavailable'", async () => {
      const { Capacitor } = await import('@capacitor/core');
      Capacitor.getPlatform.mockReturnValue('ios');
      Capacitor.isNativePlatform.mockReturnValue(true);
      const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
      NativeBiometric.isAvailable.mockRejectedValue(new Error('hardware failure'));
      const { checkBiometric } = await import('./biometric');
      await expect(checkBiometric()).resolves.toBe('unavailable');
    });

    it("web → short-circuits to 'unavailable' without calling NativeBiometric", async () => {
      const { Capacitor } = await import('@capacitor/core');
      Capacitor.getPlatform.mockReturnValue('web');
      Capacitor.isNativePlatform.mockReturnValue(false);
      const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
      const { checkBiometric } = await import('./biometric');
      await expect(checkBiometric()).resolves.toBe('unavailable');
      expect(NativeBiometric.isAvailable).not.toHaveBeenCalled();
    });
  });

  describe('authenticateWithBiometric()', () => {
    it('ios + verifyIdentity resolves → true', async () => {
      const { Capacitor } = await import('@capacitor/core');
      Capacitor.getPlatform.mockReturnValue('ios');
      Capacitor.isNativePlatform.mockReturnValue(true);
      const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
      NativeBiometric.verifyIdentity.mockResolvedValue(undefined);
      const { authenticateWithBiometric } = await import('./biometric');
      await expect(authenticateWithBiometric('Unlock LeanShot')).resolves.toBe(true);
      expect(NativeBiometric.verifyIdentity).toHaveBeenCalledWith({
        reason: 'Unlock LeanShot',
        title: 'Unlock LeanShot',
        subtitle: 'Use Face ID / Touch ID to open the app',
        description: 'Falls back to your account password if biometrics fail',
      });
    });

    it('ios + verifyIdentity throws (cancel) → false', async () => {
      const { Capacitor } = await import('@capacitor/core');
      Capacitor.getPlatform.mockReturnValue('ios');
      Capacitor.isNativePlatform.mockReturnValue(true);
      const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
      NativeBiometric.verifyIdentity.mockRejectedValue(new Error('User cancelled'));
      const { authenticateWithBiometric } = await import('./biometric');
      await expect(authenticateWithBiometric('Unlock LeanShot')).resolves.toBe(false);
    });

    it('web → short-circuits to false without calling NativeBiometric', async () => {
      const { Capacitor } = await import('@capacitor/core');
      Capacitor.getPlatform.mockReturnValue('web');
      Capacitor.isNativePlatform.mockReturnValue(false);
      const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
      const { authenticateWithBiometric } = await import('./biometric');
      await expect(authenticateWithBiometric('Unlock LeanShot')).resolves.toBe(false);
      expect(NativeBiometric.verifyIdentity).not.toHaveBeenCalled();
    });
  });
});

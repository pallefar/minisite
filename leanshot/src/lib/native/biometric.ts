// Phase 16 Plan 16-02 fill — Biometric unlock bridge (MOBILE-07, CONTEXT D-06).
// Firewall zone: shared / no restriction (PATTERNS §"ESLint Firewall — Adding
// New Native Files" — no new zone needed; this file is not in the Phase 12
// D-02 6-zone target set).
// Source: RESEARCH Pattern 5 + capgo.app/docs/plugins/native-biometric/.
//
// Web platforms short-circuit to 'unavailable' / false without touching
// NativeBiometric so the WebView build (npx cap serve) and Vitest jsdom
// environment never hit unresolved native bindings.
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { detectPlatform } from './platform';

export type BiometricAvailability = 'available' | 'unavailable' | 'permission-denied';

export async function checkBiometric(): Promise<BiometricAvailability> {
  const p = detectPlatform();
  if (p === 'web' || p === 'capacitor-web') return 'unavailable';
  try {
    const { isAvailable } = await NativeBiometric.isAvailable();
    return isAvailable ? 'available' : 'unavailable';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return /permission/i.test(msg) ? 'permission-denied' : 'unavailable';
  }
}

export async function authenticateWithBiometric(reason: string): Promise<boolean> {
  const p = detectPlatform();
  if (p === 'web' || p === 'capacitor-web') return false;
  try {
    await NativeBiometric.verifyIdentity({
      reason,
      title: 'Unlock LeanShot',
      subtitle: 'Use Face ID / Touch ID to open the app',
      description: 'Falls back to your account password if biometrics fail',
    });
    return true;
  } catch {
    // User cancelled, hardware error, or biometric mismatch — fall back to false.
    return false;
  }
}

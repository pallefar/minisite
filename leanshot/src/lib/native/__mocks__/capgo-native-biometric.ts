import { vi } from 'vitest';

export const NativeBiometric = {
  isAvailable: vi.fn(async () => ({ isAvailable: true, biometryType: 'FACE_ID' })),
  verifyIdentity: vi.fn(async () => undefined),
};

export const __mock = {
  reset() {
    NativeBiometric.isAvailable.mockImplementation(async () => ({
      isAvailable: true,
      biometryType: 'FACE_ID',
    }));
    NativeBiometric.verifyIdentity.mockImplementation(async () => undefined);
  },
};

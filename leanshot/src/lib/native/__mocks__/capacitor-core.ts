import { vi } from 'vitest';

export const Capacitor = {
  getPlatform: vi.fn(() => 'web'),
  isNativePlatform: vi.fn(() => false),
};

export const __mock = {
  reset() {
    Capacitor.getPlatform.mockReturnValue('web');
    Capacitor.isNativePlatform.mockReturnValue(false);
  },
};

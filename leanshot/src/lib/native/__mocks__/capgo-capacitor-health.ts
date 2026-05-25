import { vi } from 'vitest';

export const Health = {
  isAvailable: vi.fn(async () => ({ available: true })),
  requestAuthorization: vi.fn(async () => ({ authorized: true })),
  readSamples: vi.fn(async (_opts: { dataType: string }) => ({ samples: [] })),
};

export const __mock = {
  reset() {
    Health.isAvailable.mockImplementation(async () => ({ available: true }));
    Health.requestAuthorization.mockImplementation(async () => ({ authorized: true }));
    Health.readSamples.mockImplementation(async () => ({ samples: [] }));
  },
};

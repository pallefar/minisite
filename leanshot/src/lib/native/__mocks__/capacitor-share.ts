import { vi } from 'vitest';

export const Share = {
  share: vi.fn(async (_opts: unknown) => ({ activityType: 'mock' })),
};

export const __mock = {
  reset() {
    Share.share.mockImplementation(async (_opts: unknown) => ({ activityType: 'mock' }));
  },
};

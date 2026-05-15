import { vi } from 'vitest';

export type URLOpenListenerEvent = { url: string };

export const App = {
  addListener: vi.fn(async (_event: string, _handler: unknown) => ({ remove: vi.fn() })),
};

export const __mock = {
  reset() {
    App.addListener.mockImplementation(async (_event: string, _handler: unknown) => ({
      remove: vi.fn(),
    }));
  },
};

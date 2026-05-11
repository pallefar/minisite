/**
 * Tests for the Zustand store action `updateLastAssistant` introduced in
 * Phase 4 Plan 04-02 Task 2 (streaming UX support — see PATTERNS line
 * 791-796 Option (a)).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';

describe('updateLastAssistant', () => {
  beforeEach(() => {
    useStore.setState({ aiHistory: [] });
  });

  it('appends delta to last assistant message', () => {
    useStore.setState({
      aiHistory: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'Hel' },
      ],
    });
    useStore.getState().updateLastAssistant('lo');
    const history = useStore.getState().aiHistory;
    expect(history[history.length - 1]).toEqual({ role: 'assistant', content: 'Hello' });
  });

  it('no-ops when last message is a user message', () => {
    useStore.setState({
      aiHistory: [
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'next?' },
      ],
    });
    useStore.getState().updateLastAssistant('xx');
    const history = useStore.getState().aiHistory;
    expect(history[history.length - 1]).toEqual({ role: 'user', content: 'next?' });
  });

  it('no-ops on empty history', () => {
    useStore.setState({ aiHistory: [] });
    useStore.getState().updateLastAssistant('xx');
    expect(useStore.getState().aiHistory).toEqual([]);
  });

  it('preserves other messages (does not mutate earlier history)', () => {
    useStore.setState({
      aiHistory: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'one' },
        { role: 'user', content: 'more' },
        { role: 'assistant', content: 'two' },
      ],
    });
    useStore.getState().updateLastAssistant(' more');
    const history = useStore.getState().aiHistory;
    expect(history).toHaveLength(4);
    expect(history[0]).toEqual({ role: 'user', content: 'hi' });
    expect(history[1]).toEqual({ role: 'assistant', content: 'one' });
    expect(history[2]).toEqual({ role: 'user', content: 'more' });
    expect(history[3]).toEqual({ role: 'assistant', content: 'two more' });
  });
});

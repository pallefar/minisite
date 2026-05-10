import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useConfirm } from './useConfirm';

describe('useConfirm', () => {
  it('returns a Promise that resolves to true when handleConfirm is called', async () => {
    const { result } = renderHook(() => useConfirm());
    let p!: Promise<boolean>;
    act(() => { p = result.current.confirm('Sure?'); });
    expect(result.current.open).toBe(true);
    expect(result.current.message).toBe('Sure?');
    act(() => { result.current.handleConfirm(); });
    await expect(p).resolves.toBe(true);
    expect(result.current.open).toBe(false);
  });

  it('returns a Promise that resolves to false when handleCancel is called', async () => {
    const { result } = renderHook(() => useConfirm());
    let p!: Promise<boolean>;
    act(() => { p = result.current.confirm('Sure?'); });
    act(() => { result.current.handleCancel(); });
    await expect(p).resolves.toBe(false);
  });

  it('resolves prior promise to false when confirm() is called again while pending', async () => {
    const { result } = renderHook(() => useConfirm());
    let p1!: Promise<boolean>;
    let p2!: Promise<boolean>;
    act(() => { p1 = result.current.confirm('First'); });
    act(() => { p2 = result.current.confirm('Second'); });
    await expect(p1).resolves.toBe(false);
    act(() => { result.current.handleConfirm(); });
    await expect(p2).resolves.toBe(true);
  });

  it('honors destructive option and label overrides', () => {
    const { result } = renderHook(() => useConfirm());
    act(() => {
      void result.current.confirm('Erase?', {
        title: 'Erase data',
        confirmLabel: 'Erase',
        cancelLabel: 'Keep',
        destructive: true,
      });
    });
    expect(result.current.title).toBe('Erase data');
    expect(result.current.confirmLabel).toBe('Erase');
    expect(result.current.cancelLabel).toBe('Keep');
    expect(result.current.destructive).toBe(true);
  });
});

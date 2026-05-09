import { useEffect, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * Animate a numeric value from 0 (or `from`) up to `value` on first mount.
 * Skips animation entirely if reduced motion is requested.
 */
export function useCountUp(value: number, opts?: { duration?: number; from?: number; decimals?: number }): number {
  const reduced = useReducedMotion();
  const duration = opts?.duration ?? 800;
  const from = opts?.from ?? 0;
  const [display, setDisplay] = useState<number>(reduced ? value : from);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const delta = value - from;
    const ease = (t: number): number => 1 - Math.pow(1 - t, 4); // ease-out-quart

    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(from + delta * ease(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, from, duration, reduced]);

  return display;
}

import { useState, type ReactNode } from 'react';
import { useDrag } from '@use-gesture/react';
import { Trash2 } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export interface SwipeToDeleteProps {
  onDelete: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * Wrap any list item to enable swipe-left-to-delete on mobile.
 * Reveals a destructive action behind the content. Confirms via threshold
 * (60px + velocity) and auto-resets otherwise. Falls back to whatever
 * existing delete affordance the child already provides for keyboard /
 * reduced-motion users.
 */
export function SwipeToDelete({ onDelete, children, className }: SwipeToDeleteProps) {
  const [x, setX] = useState(0);
  const [animating, setAnimating] = useState(true);
  const reduced = useReducedMotion();

  const bind = useDrag(
    ({ active, movement: [mx], velocity: [vx], cancel }) => {
      if (reduced) return cancel?.();
      if (mx > 0) {
        setAnimating(true);
        setX(0);
        return;
      }
      if (active) {
        setAnimating(false);
        setX(Math.max(-160, mx));
      } else {
        const threshold = mx < -110 || (mx < -60 && vx > 0.5);
        setAnimating(true);
        if (threshold) {
          setX(-360);
          setTimeout(onDelete, 200);
        } else {
          setX(0);
        }
      }
    },
    { axis: 'x', filterTaps: true },
  );

  return (
    <div className={className} style={{ position: 'relative', overflow: 'hidden', borderRadius: 'inherit' }}>
      <div
        aria-hidden
        className="absolute inset-y-0 right-0 w-[120px] flex items-center justify-end pr-5 bg-[var(--color-danger)] text-white"
        style={{ borderRadius: 'inherit' }}
      >
        <Trash2 className="size-5" />
      </div>
      <div
        {...bind()}
        style={{
          transform: `translateX(${x}px)`,
          transition: animating ? 'transform 220ms cubic-bezier(0.25, 1, 0.5, 1)' : 'none',
          touchAction: 'pan-y',
        }}
        className="relative bg-[var(--color-surface)] h-full w-full"
      >
        {children}
      </div>
    </div>
  );
}

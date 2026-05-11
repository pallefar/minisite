import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/helpers';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Approx height as fraction of viewport, only on mobile. Default 0.75. */
  height?: number;
  children?: ReactNode;
}

/**
 * Apple-style bottom sheet. Drag-to-dismiss. Backdrop blur. Auto-restores
 * scroll. On md+ it acts like a centered modal so the same component works
 * across breakpoints.
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const controls = useDragControls();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[110] flex items-end md:items-center justify-center bg-[var(--color-surface-overlay)] backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : 'Quick action'}
        >
          <motion.div
            drag="y"
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 800) onClose();
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className={cn(
              'relative w-full md:max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl rounded-t-[28px] md:rounded-card max-h-[90vh] overflow-hidden flex flex-col',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="pt-3 pb-1 cursor-grab active:cursor-grabbing flex justify-center"
              onPointerDown={(e) => controls.start(e)}
            >
              <span
                aria-hidden
                className="block h-1.5 w-12 rounded-pill bg-[var(--color-border-strong)]"
              />
            </div>
            {title && <h2 className="px-5 pb-3 text-[16px] font-bold tracking-tight">{title}</h2>}
            <div className="overflow-y-auto px-5 pb-6 safe-bottom">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

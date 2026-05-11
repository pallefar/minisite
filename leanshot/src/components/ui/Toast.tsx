import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Info } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '@/lib/helpers';
import { useStore } from '@/lib/store';

export function Toast() {
  const toast = useStore((s) => s.toast);
  const dismiss = useStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismiss, 2400);
    return () => clearTimeout(t);
  }, [toast, dismiss]);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
          className={cn(
            'fixed left-1/2 -translate-x-1/2 z-[200] inline-flex items-center gap-2 px-4 py-2.5 rounded-pill font-semibold text-[13px] shadow-lg',
            'bottom-[calc(96px+env(safe-area-inset-bottom,0))] md:bottom-10',
            toast.kind === 'success' && 'bg-[var(--color-success)] text-white',
            toast.kind === 'error' && 'bg-[var(--color-danger)] text-white',
            toast.kind === 'info' && 'bg-[var(--color-text)] text-[var(--color-bg)]',
          )}
        >
          {toast.kind === 'success' && <Check className="size-4" />}
          {toast.kind === 'error' && <X className="size-4" />}
          {toast.kind === 'info' && <Info className="size-4" />}
          <span>{toast.message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/helpers';
import { IconButton } from './Button';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Render fullscreen on small screens. Useful for forms with many fields. */
  mobileFullscreen?: boolean;
  children?: ReactNode;
  headerAction?: ReactNode;
  /** Hide the default close button (e.g. for confirmation modals with explicit buttons). */
  hideClose?: boolean;
}

const sizeClasses: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  mobileFullscreen,
  headerAction,
  hideClose,
  children,
}: ModalProps) {
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
          className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-[var(--color-surface-overlay)] backdrop-blur-md p-0 md:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : 'Dialog'}
        >
          <motion.div
            className={cn(
              'w-full bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl flex flex-col max-h-[92vh] overflow-hidden',
              mobileFullscreen
                ? 'rounded-t-[28px] md:rounded-card md:max-w-md'
                : 'rounded-t-[28px] md:rounded-card',
              sizeClasses[size],
            )}
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.25, 1, 0.5, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {(title || !hideClose || headerAction) && (
              <div className="flex items-center gap-2 px-5 md:px-6 pt-5 md:pt-6 pb-3 md:pb-4 border-b border-[var(--color-border)]">
                {/* Mobile drag handle */}
                <span aria-hidden className="md:hidden absolute top-2 left-1/2 -translate-x-1/2 h-1 w-10 rounded-pill bg-[var(--color-border-strong)]" />
                <h2 className="flex-1 text-[16px] font-bold tracking-tight">{title}</h2>
                {headerAction}
                {!hideClose && (
                  <IconButton aria-label="Close" onClick={onClose} size="sm">
                    <X className="size-5" />
                  </IconButton>
                )}
              </div>
            )}
            <div className="overflow-y-auto px-5 md:px-6 py-5 md:py-6 safe-bottom">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

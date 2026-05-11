import { useCallback, useRef, useState } from 'react';

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/**
 * Promise-based confirm hook. Replaces native `confirm()` so a11y rules
 * (focus trap, role="dialog", screen-reader labels) work via the existing
 * Modal primitive. Compose with <ConfirmModal {...rest} /> in the same render.
 *
 * NOTE: A second `confirm()` call while a prior is still pending resolves
 * the prior to `false` (treated as cancel) so awaiting callers don't hang.
 */
export function useConfirm() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState<string | undefined>(undefined);
  const [confirmLabel, setConfirmLabel] = useState('Confirm');
  const [cancelLabel, setCancelLabel] = useState('Cancel');
  const [destructive, setDestructive] = useState(false);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((msg: string, opts: ConfirmOptions = {}): Promise<boolean> => {
    // Resolve any pending prior promise to false before replacing
    resolveRef.current?.(false);
    setMessage(msg);
    setTitle(opts.title);
    setConfirmLabel(opts.confirmLabel ?? 'Confirm');
    setCancelLabel(opts.cancelLabel ?? 'Cancel');
    setDestructive(opts.destructive ?? false);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleConfirm = useCallback((): void => {
    setOpen(false);
    const r = resolveRef.current;
    resolveRef.current = null;
    r?.(true);
  }, []);

  const handleCancel = useCallback((): void => {
    setOpen(false);
    const r = resolveRef.current;
    resolveRef.current = null;
    r?.(false);
  }, []);

  return {
    confirm,
    open,
    message,
    title,
    confirmLabel,
    cancelLabel,
    destructive,
    handleConfirm,
    handleCancel,
  };
}

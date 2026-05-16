/**
 * Phase 22 Plan 22-06 — kebab popover for per-row member actions.
 *
 * UI-SPEC §/admin/members line 241 + Copywriting lines 474-479.
 *
 * Actions:
 *   - Impersonate              → plan 22-09 wires Edge Function; here we
 *                                emit `onImpersonate(userId)` to caller stub.
 *   - Refund last charge       → opens RefundModal (plan 22-07). Disabled
 *                                placeholder until that plan lands.
 *   - Cancel subscription      → plan 22-07 / 22-12. Disabled placeholder.
 *   - Deactivate               → plan 22-09. Disabled placeholder.
 *   - Override feature flag    → navigates to /admin/members/{id}?tab=flags.
 *   - View detail              → navigates to /admin/members/{id}.
 */
import { MoreVertical } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/helpers';

export interface MemberRowActionsProps {
  userId: string;
  email: string;
  /** Stubbed handler — plan 22-09 wires real Edge Function. */
  onImpersonate?: (userId: string) => void;
}

interface ActionItem {
  key: string;
  label: string;
  href?: string;
  disabled?: boolean;
  disabledReason?: string;
  onSelect?: () => void;
}

export function MemberRowActions({ userId, email, onImpersonate }: MemberRowActionsProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items: ActionItem[] = [
    {
      key: 'impersonate',
      label: 'Impersonate',
      onSelect: () => {
        setOpen(false);
        onImpersonate?.(userId);
      },
    },
    {
      key: 'refund',
      label: 'Refund last charge',
      disabled: true,
      disabledReason: 'Refund modal lands in plan 22-07',
    },
    {
      key: 'cancel',
      label: 'Cancel subscription',
      disabled: true,
      disabledReason: 'Cancel flow lands in plan 22-07',
    },
    {
      key: 'deactivate',
      label: 'Deactivate',
      disabled: true,
      disabledReason: 'Deactivate flow lands in plan 22-09',
    },
    {
      key: 'override-flag',
      label: 'Override feature flag',
      href: `/admin/members/${userId}?tab=flags`,
    },
    {
      key: 'view',
      label: 'View detail',
      href: `/admin/members/${userId}`,
    },
  ];

  return (
    <div className="relative inline-block text-left">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Open actions for ${email}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center size-8 rounded-xl text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
      >
        <MoreVertical className="size-4" aria-hidden />
      </button>
      {open && (
        <div
          ref={popoverRef}
          role="menu"
          aria-label={`Actions for ${email}`}
          tabIndex={-1}
          className="absolute right-0 mt-1 w-56 z-50 rounded-card border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow)] py-1"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          {items.map((item) =>
            item.href ? (
              <a
                key={item.key}
                role="menuitem"
                href={item.href}
                className="block px-3 py-2 text-[13px] text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)]"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.disabledReason}
                onClick={item.onSelect}
                className={cn(
                  'w-full text-left px-3 py-2 text-[13px]',
                  item.disabled
                    ? 'text-[var(--color-text-tertiary)] cursor-not-allowed'
                    : 'text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)]',
                )}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

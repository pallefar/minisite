/**
 * Phase 5 Plan 05-02 Task 3 — AvatarMenu (UI-SPEC §9).
 *
 * Conditional menu items:
 *   - **Anon**: "Save your data" (→ #/auth/signup), "Settings".
 *   - **Permanent unverified**: "Verify pending" (→ #/auth/verify-sent),
 *     "Settings", "Sign out".
 *   - **Permanent verified**: "Account" (→ #/auth/settings-account, falls
 *     through to opening Settings), "Settings", "Sign out".
 *
 * Status dot: amber for unverified/anon, teal for permanent-verified.
 *
 * Keyboard nav:
 *   - Enter/Space on avatar → open + focus first menuitem.
 *   - Esc → close + restore focus to avatar.
 *   - ArrowUp/Down → cycle (wrap).
 *   - Tab / outside click → close.
 */
import { LogOut, Settings as SettingsIcon, UploadCloud, UserCircle2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { useStore } from '@/lib/store';

interface AvatarMenuProps {
  /** Optional: hook into existing settings-drawer open from the host (Topbar). */
  onOpenSettings?: () => void;
}

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  action: () => void;
}

export function AvatarMenu({ onOpenSettings }: AvatarMenuProps) {
  const signedIn = useStore((s) => s.signedIn);
  const signOut = useStore((s) => s.signOut);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<HTMLButtonElement[]>([]);

  const user = signedIn?.user;
  const isAnon = Boolean(user?.is_anonymous);
  const verified = signedIn?.verified === true;

  const initials = useMemo<string>(() => {
    if (!user) return '?';
    if (isAnon) return '?';
    const e = user.email ?? '';
    return e.slice(0, 2).toUpperCase();
  }, [user, isAnon]);

  const statusDotClass = verified ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning,#a36a00)]';

  const items: MenuItem[] = useMemo(() => {
    const list: MenuItem[] = [];
    if (isAnon) {
      list.push({
        id: 'save',
        label: 'Save your data',
        icon: <UploadCloud className="size-4" aria-hidden />,
        action: () => {
          window.location.hash = '#/auth/signup';
        },
      });
    } else if (!verified) {
      list.push({
        id: 'verify',
        label: 'Verify pending',
        icon: <UploadCloud className="size-4" aria-hidden />,
        action: () => {
          window.location.hash = '#/auth/verify-sent';
        },
      });
    } else {
      list.push({
        id: 'account',
        label: 'Account',
        icon: <UserCircle2 className="size-4" aria-hidden />,
        action: () => {
          onOpenSettings?.();
        },
      });
    }
    list.push({
      id: 'settings',
      label: 'Settings',
      icon: <SettingsIcon className="size-4" aria-hidden />,
      action: () => {
        onOpenSettings?.();
      },
    });
    if (!isAnon) {
      list.push({
        id: 'signout',
        label: 'Sign out',
        icon: <LogOut className="size-4" aria-hidden />,
        action: async () => {
          await signOut();
          toast('Signed out. Your data on this device has been cleared.', 'info');
        },
      });
    }
    return list;
  }, [isAnon, verified, signOut, toast, onOpenSettings]);

  // Outside click + Esc to close.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (!menuRef.current || !avatarRef.current) return;
      const t = e.target as Node;
      if (!menuRef.current.contains(t) && !avatarRef.current.contains(t)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
        avatarRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Focus first menuitem when opening.
  useEffect(() => {
    if (open) {
      setFocusIdx(0);
      // Microtask delay so the menu is mounted before focus.
      queueMicrotask(() => itemRefs.current[0]?.focus());
    }
  }, [open]);

  if (!user) return null;

  const onAvatarKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onItemKey = (e: React.KeyboardEvent, idx: number): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const n = (idx + 1) % items.length;
      setFocusIdx(n);
      itemRefs.current[n]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const p = (idx - 1 + items.length) % items.length;
      setFocusIdx(p);
      itemRefs.current[p]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusIdx(0);
      itemRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = items.length - 1;
      setFocusIdx(last);
      itemRefs.current[last]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={avatarRef}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onAvatarKey}
        className="relative size-10 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] inline-flex items-center justify-center font-semibold text-[12px] text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
      >
        {initials}
        <span
          aria-hidden
          className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[var(--color-bg)] ${statusDotClass}`}
        />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 mt-2 w-56 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg z-50 py-1.5"
        >
          {items.map((it, idx) => (
            <button
              key={it.id}
              ref={(el) => {
                if (el) itemRefs.current[idx] = el;
              }}
              role="menuitem"
              tabIndex={focusIdx === idx ? 0 : -1}
              onKeyDown={(e) => onItemKey(e, idx)}
              onClick={() => {
                setOpen(false);
                it.action();
              }}
              className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-[14px] hover:bg-[var(--color-surface-elevated)] focus-visible:bg-[var(--color-surface-elevated)] focus-visible:outline-none"
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default AvatarMenu;

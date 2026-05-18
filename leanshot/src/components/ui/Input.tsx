import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/helpers';

const fieldShellBase =
  'group relative flex items-center gap-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] ' +
  'transition-[box-shadow,border-color] focus-within:border-[var(--color-primary)] focus-within:shadow-[0_0_0_3px_var(--color-primary-soft)] ' +
  'has-[:disabled]:opacity-60 has-[:disabled]:bg-[var(--color-surface-elevated)]';

const fieldErrorClass =
  'border-[var(--color-danger)] focus-within:border-[var(--color-danger)] focus-within:shadow-[0_0_0_3px_var(--color-danger-soft)]';

interface FieldShellProps {
  label?: string;
  hint?: string;
  error?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function FieldShell({
  label,
  hint,
  error,
  leadingIcon,
  trailingIcon,
  required,
  htmlFor,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]"
        >
          {label}
          {required && (
            <span aria-hidden className="ms-1 text-[var(--color-warning)]">
              *
            </span>
          )}
        </label>
      )}
      <div className={cn(fieldShellBase, error && fieldErrorClass)}>
        {leadingIcon && (
          <span className="ps-3 inline-flex shrink-0 text-[var(--color-text-tertiary)]" aria-hidden>
            {leadingIcon}
          </span>
        )}
        {children}
        {trailingIcon && (
          <span className="pe-3 inline-flex shrink-0 text-[var(--color-text-tertiary)]" aria-hidden>
            {trailingIcon}
          </span>
        )}
      </div>
      {(hint || error) && (
        <p
          className={cn(
            'text-[12px] leading-snug',
            error ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-tertiary)]',
          )}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------- Input -------------------------------------------- */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leadingIcon, trailingIcon, className, id, required, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? `in-${auto}`;
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      leadingIcon={leadingIcon}
      trailingIcon={trailingIcon}
      required={required}
      htmlFor={inputId}
    >
      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={!!error || undefined}
        className={cn(
          'flex-1 bg-transparent border-none outline-none px-4 py-3 text-[14px] placeholder:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed',
          Boolean(leadingIcon) && 'ps-1.5',
          Boolean(trailingIcon) && 'pe-1.5',
          className,
        )}
        {...rest}
      />
    </FieldShell>
  );
});

/* -------------------------------------------- Select ------------------------------------------- */

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, className, id, required, children, ...rest },
  ref,
) {
  const auto = useId();
  const selectId = id ?? `sel-${auto}`;
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} htmlFor={selectId}>
      <select
        ref={ref}
        id={selectId}
        required={required}
        aria-invalid={!!error || undefined}
        className={cn(
          'flex-1 bg-transparent border-none outline-none appearance-none px-4 py-3 pe-10 text-[14px] cursor-pointer disabled:cursor-not-allowed bg-no-repeat bg-[length:18px_18px] bg-[right_14px_center]',
          className,
        )}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
        }}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
});

/* -------------------------------------------- Textarea ----------------------------------------- */

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id, required, rows = 3, ...rest },
  ref,
) {
  const auto = useId();
  const taId = id ?? `ta-${auto}`;
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} htmlFor={taId}>
      <textarea
        ref={ref}
        id={taId}
        rows={rows}
        required={required}
        aria-invalid={!!error || undefined}
        className={cn(
          'flex-1 bg-transparent border-none outline-none resize-y px-4 py-3 text-[14px] placeholder:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed leading-snug',
          className,
        )}
        {...rest}
      />
    </FieldShell>
  );
});

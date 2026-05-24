/**
 * Phase 41 Plan 41-06 — AddHostnameForm.
 *
 * Inline form (Input + primary Button) with 5 client-side validation rules
 * per UI-SPEC §Surface E + §Copywriting Contract. Calls
 * `addHostname` from `@/lib/admin/iframe-allowlist` (Plan 41-02 wrapper).
 *
 * Server-side SECDEF gate enforces superadmin. On 42501 (forbidden) we surface
 * the dual-layer denial copy "Only superadmins can add hostnames" inline.
 */
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { addHostname } from '@/lib/admin/iframe-allowlist';
import { supabase } from '@/lib/supabase';

export interface AddHostnameFormProps {
  /** Current allowlist hostnames — used for the duplicate validation rule. */
  allowlist: ReadonlyArray<{ hostname: string }>;
  /** Fires after a successful add so the parent can refetch + insert optimistically. */
  onAdded: (hostname: string) => void;
}

function validate(
  raw: string,
  allowlist: ReadonlyArray<{ hostname: string }>,
): string | null {
  const value = raw.trim();
  if (!value) return 'Hostname is required';
  if (value.includes('://')) return 'Enter hostname only — no protocol';
  if (value.includes('/') || value.includes('?'))
    return 'Enter hostname only — no path or query';
  if (value.includes('*') || value.startsWith('.'))
    return 'Wildcards and leading dots are not supported';
  if (allowlist.some((row) => row.hostname.toLowerCase() === value.toLowerCase()))
    return `${value} is already on the allowlist`;
  return null;
}

export function AddHostnameForm({ allowlist, onAdded }: AddHostnameFormProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const validation = validate(value, allowlist);
    if (validation !== null) {
      setError(validation);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const hostname = value.trim();
      await addHostname(supabase, hostname);
      toast(`Added ${hostname} to allowlist`, 'success');
      onAdded(hostname);
      setValue('');
    } catch (err) {
      // PostgREST returns 403 / 42501 string on policy denial; SECDEF body may
      // also raise insufficient_privilege. Surface the dual-layer denial copy.
      const e = err as { code?: string; message?: string };
      if (e?.code === '42501' || /forbidden|not authorized|permission/i.test(e?.message ?? '')) {
        setError('Only superadmins can add hostnames');
      } else {
        setError(e?.message ?? 'Failed to add hostname');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card variant="elevated" padding="lg" className="mt-6">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col md:flex-row md:items-end gap-4"
        noValidate
      >
        <div className="flex-1">
          <Input
            label="Hostname"
            placeholder="meet.example.com"
            hint="Exact hostname only — do not include https://, paths, or wildcards."
            value={value}
            onChange={(ev) => {
              setValue(ev.currentTarget.value);
              if (error !== null) setError(null);
            }}
            error={error ?? undefined}
            aria-invalid={error !== null || undefined}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="md:pb-1">
          <Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
            Add hostname
          </Button>
        </div>
      </form>
    </Card>
  );
}

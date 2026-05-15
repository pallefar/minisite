/**
 * Phase 15 Plan 09 — AssetLibraryPicker modal (D-13).
 *
 * Image library + upload picker for the page-builder property panel.
 * D-13 contract:
 *   • Upload accepts image/jpeg, image/png, image/webp, image/gif (≤ 10 MB).
 *   • Alt-text is REQUIRED. Confirm button stays disabled until alt-text
 *     is non-empty; uploadPageAsset() also rejects 'missing_alt' as a
 *     server-side floor.
 *   • When an existing image with stored alt-text is selected, the field
 *     pre-fills with that value (operator can override before re-using).
 *
 * RLS: list/upload calls run as the signed-in staff user; non-staff
 * sessions are denied by Postgres RLS on the `page-assets` bucket. No
 * client-side gate is added here (T-15-09-02).
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  listPageAssets,
  uploadPageAsset,
  type PageAsset,
  type UploadError,
} from '@/lib/page-builder/page-assets';
import { cn } from '@/lib/helpers';

export interface AssetSelection {
  path: string;
  url: string;
  altText: string;
}

export interface AssetLibraryPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (asset: AssetSelection) => void;
}

const ACCEPTED_MIMES = 'image/jpeg,image/png,image/webp,image/gif';

function errorCopyFor(error: UploadError): string {
  switch (error) {
    case 'file_too_large':
    case 'invalid_mime':
    case 'network':
      return 'Upload failed. Images must be under 10 MB. Try a different file.';
    case 'missing_alt':
      return 'Add alt text before uploading.';
  }
}

export function AssetLibraryPicker({ open, onClose, onSelect }: AssetLibraryPickerProps) {
  const [assets, setAssets] = useState<PageAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<PageAsset | null>(null);
  const [altDraft, setAltDraft] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const altInputId = useId();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listPageAssets();
      setAssets(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setAltDraft('');
    setPendingFile(null);
    setError(null);
    void refresh();
  }, [open, refresh]);

  function pickExisting(asset: PageAsset): void {
    setSelected(asset);
    setPendingFile(null);
    setAltDraft(asset.altText ?? '');
    setError(null);
  }

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setSelected(null);
    setAltDraft('');
    setError(null);
  }

  async function handleConfirm(): Promise<void> {
    const altText = altDraft.trim();
    if (altText === '') return; // button stays disabled — defensive
    if (pendingFile) {
      setUploading(true);
      const result = await uploadPageAsset(pendingFile, altText);
      setUploading(false);
      if (!result.ok) {
        setError(errorCopyFor(result.error));
        return;
      }
      onSelect({ path: result.path, url: result.url, altText: result.altText });
      onClose();
      return;
    }
    if (selected) {
      onSelect({ path: selected.path, url: selected.url, altText });
      onClose();
      return;
    }
  }

  const hasSelection = !!selected || !!pendingFile;
  const confirmDisabled = !hasSelection || altDraft.trim() === '' || uploading;

  return (
    <Modal open={open} onClose={onClose} title="Asset library" size="lg">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Upload images to use across any landing page.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          Upload image
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_MIMES}
          className="hidden"
          onChange={onFileChosen}
        />
      </div>

      {/* Pending-upload preview row */}
      {pendingFile && (
        <div className="mb-3 p-3 rounded-card bg-[var(--color-surface-elevated)] border border-[var(--color-primary-soft)]">
          <p className="text-[13px] font-semibold">Ready to upload</p>
          <p className="text-[13px] text-[var(--color-text-secondary)] truncate">
            {pendingFile.name}
          </p>
        </div>
      )}

      {/* Asset grid / empty state / loading state */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-xl" />
          ))}
        </div>
      ) : assets.length === 0 && !pendingFile ? (
        <div className="text-center py-10">
          <p className="text-[16px] font-semibold">No images uploaded</p>
          <p className="text-[13px] text-[var(--color-text-secondary)] mt-1">
            Upload images to use across any landing page.
          </p>
        </div>
      ) : (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 gap-3"
          role="listbox"
          aria-label="Uploaded images"
        >
          {assets.map((asset) => {
            const isSelected = selected?.path === asset.path;
            return (
              <button
                key={asset.path}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => pickExisting(asset)}
                className={cn(
                  'relative aspect-square rounded-xl overflow-hidden border-2 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2',
                  isSelected
                    ? 'border-[var(--color-primary)] shadow-[0_0_0_4px_var(--color-primary-soft)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-primary-soft)]',
                )}
              >
                <img
                  src={asset.url}
                  alt={asset.altText || ''}
                  className="w-full h-full object-cover bg-[var(--color-surface-elevated)]"
                />
                {isSelected && (
                  <span
                    aria-hidden
                    className="absolute top-2 right-2 size-6 rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground)] flex items-center justify-center text-[14px] font-bold"
                  >
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Alt-text + confirm row — only when something is selected/pending */}
      {hasSelection && (
        <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
          <Input
            id={altInputId}
            label="Alt text"
            aria-required="true"
            placeholder="Describe the image for screen readers"
            value={altDraft}
            onChange={(e) => setAltDraft(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-[13px] text-[var(--color-danger)] mt-2">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleConfirm()}
              disabled={confirmDisabled}
              loading={uploading}
            >
              {pendingFile ? 'Upload & use' : 'Use image'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

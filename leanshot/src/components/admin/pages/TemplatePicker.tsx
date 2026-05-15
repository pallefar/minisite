/**
 * Phase 15 Plan 09 — TemplatePicker modal (D-14).
 *
 * Shown on new-page creation only. Renders the 5 code-defined templates as
 * a clickable card grid; selecting a card calls `onScaffold` with a deep
 * copy of that template's block tree (via `scaffoldFromTemplate`) — the
 * D-14 independence invariant guarantees subsequent edits never touch the
 * source TEMPLATES entry.
 *
 * Accessibility:
 *   • Modal supplies role="dialog" + aria-modal + focus trap automatically.
 *   • Cards have role="button" + tabIndex={0} + Enter/Space keydown to
 *     match the pointer behavior for keyboard users.
 *   • Thumbnail <img alt=""> is decorative — name + description carry the
 *     accessible label.
 */
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { TEMPLATES, scaffoldFromTemplate, type TemplateId } from '@/lib/page-builder/templates';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';

export interface TemplatePickerProps {
  open: boolean;
  onClose: () => void;
  /** Receives a freshly-scaffolded BlockNode[] tree (deep-copied) for the new page. */
  onScaffold: (blocks: BlockNode[]) => void;
}

const TEMPLATE_ORDER: TemplateId[] = [
  'long-form-sales',
  'lead-magnet',
  'comparison',
  'faq',
  'testimonial',
];

export function TemplatePicker({ open, onClose, onScaffold }: TemplatePickerProps) {
  function pick(id: TemplateId): void {
    onScaffold(scaffoldFromTemplate(id));
    onClose();
  }

  function startBlank(): void {
    onScaffold([]);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Choose a template" size="lg">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {TEMPLATE_ORDER.map((id) => {
          const tpl = TEMPLATES[id];
          return (
            <Card
              key={tpl.id}
              variant="clickable"
              padding="sm"
              role="button"
              tabIndex={0}
              onClick={() => pick(tpl.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  pick(tpl.id);
                }
              }}
              aria-label={`${tpl.name} template`}
            >
              <img
                src={tpl.thumbnail}
                alt=""
                aria-hidden
                className="w-full aspect-video object-cover rounded-xl mb-2 bg-[var(--color-surface-elevated)]"
              />
              <p className="text-[16px] font-semibold">{tpl.name}</p>
              <p className="text-[13px] text-[var(--color-text-secondary)] mt-1">
                {tpl.description}
              </p>
            </Card>
          );
        })}
      </div>
      <div className="flex justify-end mt-4">
        <Button variant="ghost" onClick={startBlank}>
          Start blank
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Phase 15 Plan 15-04 — Right rail: property editor for the selected block.
 *
 * Two field groups (Content + Style) separated by --color-border dividers.
 * Style fields are TOKEN-BOUNDED (D-05): backgroundTone is an exact 4-option
 * Select, alignment is 3-option, spacingDensity is 3-option, hideOnMobile
 * is a checkbox. NO hex pickers, NO free-text style, NO typography fields.
 *
 * For the 3 Slice-1 block types the Content section renders different field
 * sets per `block.type`. For block types not yet implemented in this Slice
 * (FAQ/Pricing/etc.), we show a placeholder note — those land in 15-05+.
 */
import type { ChangeEvent } from 'react';
import { Card } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Input';
import type { BlockNode, BlockStyle } from '@/lib/page-builder/block-schema';

export interface PropertyPanelProps {
  selectedBlockId: string | null;
  blocks: BlockNode[];
  onChange: (blocks: BlockNode[]) => void;
}

export function PropertyPanel({ selectedBlockId, blocks, onChange }: PropertyPanelProps) {
  const selected = blocks.find((b) => b.id === selectedBlockId) ?? null;

  if (!selected) {
    return (
      <Card variant="flat" padding="md" className="h-full overflow-auto">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Select a block to edit its properties.
        </p>
      </Card>
    );
  }

  const updateContent = (patch: Record<string, unknown>): void => {
    onChange(
      blocks.map((b) =>
        b.id === selected.id ? { ...b, content: { ...b.content, ...patch } } : b,
      ),
    );
  };

  const updateStyle = (patch: Partial<BlockStyle>): void => {
    onChange(
      blocks.map((b) =>
        b.id === selected.id ? { ...b, style: { ...b.style, ...patch } } : b,
      ),
    );
  };

  return (
    <Card variant="flat" padding="md" className="h-full overflow-auto flex flex-col gap-4">
      <header>
        <h2 className="text-[14px] font-semibold tracking-tight">
          {selected.type.charAt(0).toUpperCase() + selected.type.slice(1)} properties
        </h2>
      </header>

      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
          Content
        </h3>
        <ContentFields block={selected} updateContent={updateContent} />
      </section>

      <div className="border-t border-[var(--color-border)]" />

      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
          Style
        </h3>
        <div className="flex flex-col gap-3">
          <Select
            label="Background tone"
            value={selected.style.backgroundTone ?? 'default'}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              updateStyle({ backgroundTone: e.target.value as BlockStyle['backgroundTone'] })
            }
          >
            <option value="default">Default</option>
            <option value="subtle">Subtle</option>
            <option value="brand">Brand</option>
            <option value="dark">Dark</option>
          </Select>
          <Select
            label="Alignment"
            value={selected.style.alignment ?? 'center'}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              updateStyle({ alignment: e.target.value as BlockStyle['alignment'] })
            }
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </Select>
          <Select
            label="Spacing density"
            value={selected.style.spacingDensity ?? 'default'}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              updateStyle({ spacingDensity: e.target.value as BlockStyle['spacingDensity'] })
            }
          >
            <option value="compact">Compact</option>
            <option value="default">Default</option>
            <option value="spacious">Spacious</option>
          </Select>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={!!selected.style.hideOnMobile}
              onChange={(e) => updateStyle({ hideOnMobile: e.target.checked })}
            />
            Hide on mobile
          </label>
        </div>
      </section>
    </Card>
  );
}

interface ContentFieldsProps {
  block: BlockNode;
  updateContent: (patch: Record<string, unknown>) => void;
}

function ContentFields({ block, updateContent }: ContentFieldsProps) {
  const content = block.content as Record<string, unknown>;
  const str = (k: string): string => (typeof content[k] === 'string' ? (content[k] as string) : '');

  if (block.type === 'hero') {
    return (
      <div className="flex flex-col gap-3">
        <Input
          label="Heading"
          value={str('heading')}
          onChange={(e) => updateContent({ heading: e.target.value })}
        />
        <Input
          label="Subheading"
          value={str('subheading')}
          onChange={(e) => updateContent({ subheading: e.target.value })}
        />
        <Input
          label="CTA label"
          value={str('ctaLabel')}
          onChange={(e) => updateContent({ ctaLabel: e.target.value })}
        />
        <Input
          label="CTA href"
          value={str('ctaHref')}
          onChange={(e) => updateContent({ ctaHref: e.target.value })}
        />
      </div>
    );
  }

  if (block.type === 'cta') {
    return (
      <div className="flex flex-col gap-3">
        <Input
          label="Heading"
          value={str('heading')}
          onChange={(e) => updateContent({ heading: e.target.value })}
        />
        <Textarea
          label="Body"
          value={str('body')}
          onChange={(e) => updateContent({ body: e.target.value })}
        />
        <Input
          label="CTA label"
          value={str('ctaLabel')}
          onChange={(e) => updateContent({ ctaLabel: e.target.value })}
        />
        <Input
          label="CTA href"
          value={str('ctaHref')}
          onChange={(e) => updateContent({ ctaHref: e.target.value })}
        />
      </div>
    );
  }

  if (block.type === 'footer') {
    return (
      <div className="flex flex-col gap-3">
        <Input
          label="Copyright text"
          value={str('copyright')}
          onChange={(e) => updateContent({ copyright: e.target.value })}
        />
      </div>
    );
  }

  return (
    <p className="text-[13px] text-[var(--color-text-secondary)]">
      Content fields for this block type land in a later plan.
    </p>
  );
}

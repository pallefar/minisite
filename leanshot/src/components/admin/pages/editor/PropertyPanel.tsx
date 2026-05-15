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
import { PROPERTY_CONFIGS, type ContentFieldConfig } from './property-configs';

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

  // 15-05: 5 new block types route through the FLAT property-configs registry.
  // Each entry's `contentFields` is rendered by GenericContentFields below.
  // Future plans (15-06/07/08) extend the registry without restructuring this
  // switch — only the existing per-type literal branches above are bespoke.
  const config = PROPERTY_CONFIGS[block.type];
  if (config) {
    return (
      <GenericContentFields
        block={block}
        fields={config.contentFields}
        updateContent={updateContent}
      />
    );
  }

  return (
    <p className="text-[13px] text-[var(--color-text-secondary)]">
      Content fields for this block type land in a later plan.
    </p>
  );
}

// ─── Generic field renderer (driven by property-configs) ──────────────────────
//
// Renders the flat content-field list for any block type registered in
// PROPERTY_CONFIGS. Sub-renderers per `kind` are co-located below — adding a
// new field kind is one local switch arm.
interface GenericContentFieldsProps {
  block: BlockNode;
  fields: ContentFieldConfig[];
  updateContent: (patch: Record<string, unknown>) => void;
}

function GenericContentFields({ block, fields, updateContent }: GenericContentFieldsProps) {
  const content = block.content as Record<string, unknown>;
  return (
    <div className="flex flex-col gap-3">
      {fields.map((f) => {
        switch (f.kind) {
          case 'text':
            return (
              <Input
                key={f.key}
                label={f.label}
                hint={f.hint}
                placeholder={f.placeholder}
                value={typeof content[f.key] === 'string' ? (content[f.key] as string) : ''}
                onChange={(e) => updateContent({ [f.key]: e.target.value })}
              />
            );
          case 'textarea':
            return (
              <Textarea
                key={f.key}
                label={f.label}
                hint={f.hint}
                placeholder={f.placeholder}
                value={typeof content[f.key] === 'string' ? (content[f.key] as string) : ''}
                onChange={(e) => updateContent({ [f.key]: e.target.value })}
              />
            );
          case 'image-url+alt':
            return (
              <div key={f.key} className="flex flex-col gap-2">
                <Input
                  label={f.label + ' URL'}
                  hint={f.hint}
                  value={typeof content['imageUrl'] === 'string' ? (content['imageUrl'] as string) : ''}
                  onChange={(e) => updateContent({ imageUrl: e.target.value })}
                />
                <Input
                  label="Image alt text"
                  hint="Required — describes the image for screen readers."
                  value={typeof content['imageAlt'] === 'string' ? (content['imageAlt'] as string) : ''}
                  onChange={(e) => updateContent({ imageAlt: e.target.value })}
                />
              </div>
            );
          case 'faq-items':
            return (
              <RepeatableJsonField
                key={f.key}
                label={f.label}
                hint="JSON array of {q, a} objects."
                value={content[f.key]}
                onChange={(v) => updateContent({ [f.key]: v })}
              />
            );
          case 'pricing-plans':
            return (
              <RepeatableJsonField
                key={f.key}
                label={f.label}
                hint="JSON array of plan objects (name, price, cadence, features[], ctaLabel, recommended?)."
                value={content[f.key]}
                onChange={(v) => updateContent({ [f.key]: v })}
              />
            );
          case 'testimonial-quotes':
            return (
              <RepeatableJsonField
                key={f.key}
                label={f.label}
                hint="JSON array of {quote, authorName, authorPhotoUrl?, authorPhotoAlt?} objects."
                value={content[f.key]}
                onChange={(v) => updateContent({ [f.key]: v })}
              />
            );
          case 'feature-items':
            return (
              <RepeatableJsonField
                key={f.key}
                label={f.label}
                hint="JSON array of {iconName, title, body} objects."
                value={content[f.key]}
                onChange={(v) => updateContent({ [f.key]: v })}
              />
            );
          case 'text-list':
            return (
              <RepeatableJsonField
                key={f.key}
                label={f.label}
                hint="JSON array of strings."
                value={content[f.key]}
                onChange={(v) => updateContent({ [f.key]: v })}
              />
            );
          // 15-06: tailored embed-provider fields (D-02). Token-bounded —
          // neither kind takes color/hex/typography input.
          case 'number':
            return (
              <Input
                key={f.key}
                type="number"
                label={f.label}
                hint={f.hint}
                placeholder={f.placeholder}
                value={typeof content[f.key] === 'number' ? String(content[f.key]) : ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    updateContent({ [f.key]: 0 });
                    return;
                  }
                  const n = Number(raw);
                  if (Number.isFinite(n)) updateContent({ [f.key]: n });
                }}
              />
            );
          case 'boolean':
            return (
              <label
                key={f.key}
                className="flex items-center gap-2 text-[13px]"
              >
                <input
                  type="checkbox"
                  checked={content[f.key] === true}
                  onChange={(e) => updateContent({ [f.key]: e.target.checked })}
                />
                {f.label}
              </label>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

// JSON-textarea editor for repeatable structured fields. Slice-2 swaps this
// for a structured row-editor; for Slice-1 the JSON view keeps the editor
// usable for staff who are comfortable with shapes.
function RepeatableJsonField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const text = (() => {
    try {
      return JSON.stringify(value ?? [], null, 2);
    } catch {
      return '[]';
    }
  })();
  return (
    <Textarea
      label={label}
      hint={hint}
      value={text}
      rows={6}
      onChange={(e) => {
        const raw = e.target.value;
        try {
          const parsed = JSON.parse(raw);
          onChange(parsed);
        } catch {
          // Keep the textbox text as-is during typing; only commit on valid
          // JSON parse. We don't surface a parse-error toast here (Slice-1
          // — the staff user can refer to the hint).
        }
      }}
    />
  );
}

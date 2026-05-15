/**
 * Phase 19 Plan 19-06b — PartnerTemplatePicker.
 *
 * 3-card grid (coach / story / method) selector. Each card is keyboard-
 * navigable (Tab cycles; Enter/Space selects). Selected card uses
 * `<Card variant="selected">`; others use `<Card variant="clickable">`.
 *
 * Spec: 19-UI-SPEC.md §/partner/links template picker + Copywriting
 * Contract template option strings.
 */
import { type ReactNode, type KeyboardEvent } from 'react';
import { Card } from '@/components/ui/Card';

export type TemplateChoice = 'coach' | 'story' | 'method';

export interface PartnerTemplatePickerProps {
  selected: TemplateChoice;
  onChange: (t: TemplateChoice) => void;
}

interface TemplateOption {
  id: TemplateChoice;
  title: string;
  body: string;
}

// UI-SPEC §Copywriting Contract /partner/links — verbatim copy.
const OPTIONS: TemplateOption[] = [
  {
    id: 'coach',
    title: 'The coach',
    body: 'Photo-forward + Calendly',
  },
  {
    id: 'story',
    title: 'The story',
    body: 'Testimonial-forward',
  },
  {
    id: 'method',
    title: 'The method',
    body: 'Benefits list, no photo',
  },
];

export function PartnerTemplatePicker({
  selected,
  onChange,
}: PartnerTemplatePickerProps): ReactNode {
  return (
    <div role="radiogroup" aria-label="Pick your landing page template" className="space-y-3">
      <h3 className="text-[14px] font-semibold text-[var(--color-text)]">Pick your landing page</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {OPTIONS.map((opt) => {
          const isSelected = opt.id === selected;
          const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onChange(opt.id);
            }
          };
          return (
            <Card
              key={opt.id}
              variant={isSelected ? 'selected' : 'clickable'}
              padding="md"
              role="radio"
              tabIndex={0}
              aria-checked={isSelected}
              data-template={opt.id}
              onClick={() => onChange(opt.id)}
              onKeyDown={onKeyDown}
              className="cursor-pointer"
            >
              <div className="text-[14px] font-semibold text-[var(--color-text)] mb-1">
                {opt.title}
              </div>
              <p className="text-[12px] text-[var(--color-text-secondary)]">{opt.body}</p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default PartnerTemplatePicker;

import { ArrowUpRight, Syringe } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { useStore } from '@/lib/store';
import { SITES } from '@/lib/constants';
import type { InjectionSite } from '@/types';

/** Body figure with site dots, color-coded by recency. */
export function SiteRotationCard() {
  const injections = useStore((s) => s.injections);
  const setTab = useStore((s) => s.setTab);

  const status: Record<InjectionSite, 'recent' | 'older' | 'next' | 'empty'> = {
    'abdomen-ul': 'empty', 'abdomen-ur': 'empty', 'abdomen-ll': 'empty', 'abdomen-lr': 'empty',
    'thigh-l': 'empty', 'thigh-r': 'empty', 'arm-l': 'empty', 'arm-r': 'empty',
  };
  injections.slice(0, 8).forEach((inj) => {
    if (!inj.site) return;
    const days = (Date.now() - new Date(inj.datetime).getTime()) / 86_400_000;
    if (days < 7 && status[inj.site] === 'empty') status[inj.site] = 'recent';
    else if (days < 14 && status[inj.site] === 'empty') status[inj.site] = 'older';
  });
  const empty = SITES.find((s) => status[s] === 'empty');
  if (empty) status[empty] = 'next';

  const colorOf = (s: InjectionSite): string =>
    status[s] === 'recent' ? 'var(--color-warning)'
    : status[s] === 'older' ? 'var(--color-amber)'
    : status[s] === 'next' ? 'var(--color-success)'
    : 'var(--color-border-strong)';

  return (
    <Card span={4} variant="default" data-tour="sites">
      <CardHeader
        title="Injection site"
        icon={<Syringe className="size-4" />}
        action={
          <button
            onClick={() => setTab('medication')}
            aria-label="Open medication tab"
            className="size-8 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <ArrowUpRight className="size-4" />
          </button>
        }
      />

      <div className="flex justify-center py-2">
        <svg width="140" viewBox="0 0 200 320" xmlns="http://www.w3.org/2000/svg" aria-label="Body diagram with injection sites">
          {/* head */}
          <circle cx="100" cy="38" r="26" fill="var(--color-surface-elevated)" stroke="var(--color-border-strong)" strokeWidth="2" />
          {/* neck */}
          <rect x="92" y="60" width="16" height="14" fill="var(--color-surface-elevated)" stroke="var(--color-border-strong)" strokeWidth="2" />
          {/* torso */}
          <path d="M70 75 Q100 70 130 75 L138 178 Q100 173 62 178 Z" fill="var(--color-surface-elevated)" stroke="var(--color-border-strong)" strokeWidth="2" />
          {/* legs */}
          <path d="M75 175 L70 285 L92 285 L98 175 Z" fill="var(--color-surface-elevated)" stroke="var(--color-border-strong)" strokeWidth="2" />
          <path d="M102 175 L108 285 L130 285 L125 175 Z" fill="var(--color-surface-elevated)" stroke="var(--color-border-strong)" strokeWidth="2" />
          {/* arms */}
          <path d="M70 80 L42 165 L52 170 L80 92 Z" fill="var(--color-surface-elevated)" stroke="var(--color-border-strong)" strokeWidth="2" />
          <path d="M130 80 L158 165 L148 170 L120 92 Z" fill="var(--color-surface-elevated)" stroke="var(--color-border-strong)" strokeWidth="2" />
          {/* dots */}
          {(
            [
              ['abdomen-ul', 86, 115], ['abdomen-ur', 114, 115],
              ['abdomen-ll', 86, 148], ['abdomen-lr', 114, 148],
              ['thigh-l', 82, 220], ['thigh-r', 118, 220],
              ['arm-l', 55, 125], ['arm-r', 145, 125],
            ] as Array<[InjectionSite, number, number]>
          ).map(([s, x, y]) => (
            <g key={s}>
              {status[s] === 'next' && (
                <circle cx={x} cy={y} r="11" fill="none" stroke={colorOf(s)} strokeWidth="1.5" opacity="0.5">
                  <animate attributeName="r" from="6" to="13" dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.6" to="0" dur="1.6s" repeatCount="indefinite" />
                </circle>
              )}
              <circle
                cx={x}
                cy={y}
                r="7"
                fill={colorOf(s)}
                stroke="var(--color-surface)"
                strokeWidth="2"
              >
                <title>{s.replace('-', ' ')} — {status[s]}</title>
              </circle>
            </g>
          ))}
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mt-2 text-[11px] text-[var(--color-text-secondary)]">
        <Legend color="var(--color-warning)" label="Recent · avoid" />
        <Legend color="var(--color-amber)" label="2 weeks ago" />
        <Legend color="var(--color-success)" label="Next" />
      </div>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

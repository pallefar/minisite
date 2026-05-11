/**
 * Chart.js per-instance plugin: diagonal two-line watermark across the drug-level chart.
 *
 * Scope: ONLY MedLevelChart (D-14). Registered via `config.plugins: [medLevelWatermarkPlugin]`
 * on the MedLevelChart instance, NEVER via `Chart.register()` globally (which would
 * leak the watermark onto weight, symptom, and sparkline charts).
 *
 * Renders in `afterDraw` so the watermark is the LAST thing painted onto the canvas
 * (above the data line + legend). Phase 3's uncertainty band uses Chart.js native
 * dataset fills (painted earlier), so this plugin's draw-order remains correct.
 *
 * Phase 3 D-08: plugin id bumped to `medLevelWatermark-v2` to signal the breaking
 * copy change (single-line "Estimate — not medical advice" → two-line PK disclaimer
 * sourced from `@/lib/disclaimers`). Disclaimer strings live in `src/lib/disclaimers.ts`
 * as the single source of truth; this plugin imports them so future text changes
 * touch only that one file.
 *
 * Two-line render rationale: the longer Phase 3 copy (96 chars total) does not
 * fit one rotated line at reasonable chart widths; split at the em-dash gives two
 * balanced lines paint-able at the same 45° angle with a single ctx.rotate.
 */
import type { Chart, Plugin } from 'chart.js';
import { PK_DISCLAIMER_LINE_1, PK_DISCLAIMER_LINE_2 } from '@/lib/disclaimers';

export interface MedLevelWatermarkOptions {
  /** RGB triplet string e.g. '60, 60, 60'. Default: '120, 120, 120'. */
  color?: string;
  /** 0..1. Default 0.12 (light theme); pass 0.18 for dark theme. */
  opacity?: number;
  /** Override text for LINE 1 only (testing convenience — production paints both
   * verbatim from `PK_DISCLAIMER_LINE_1` and `PK_DISCLAIMER_LINE_2`). Line 2 is
   * never overridden so the em-dash byte verification in tests remains stable. */
  text?: string;
  /** Override font family. */
  fontFamily?: string;
}

export const medLevelWatermarkPlugin: Plugin<'line', MedLevelWatermarkOptions> = {
  id: 'medLevelWatermark-v2',
  afterDraw(chart: Chart<'line'>, _args, options: MedLevelWatermarkOptions) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const { left, top, width, height } = chartArea;
    const cx = left + width / 2;
    const cy = top + height / 2;
    const opacity = options.opacity ?? 0.12;
    const color = options.color ?? '120, 120, 120';
    const fontFamily = options.fontFamily ?? 'Inter, system-ui, sans-serif';

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 4); // 45° counter-clockwise (D-13)
    // Font multiplier 0.06: midpoint between Phase 2's 0.08 and UI-SPEC line 61's compact-fallback 0.055; honors UI-SPEC shrink-from-0.08 intent for the longer two-line Phase 3 disclaimer.
    ctx.font = `bold ${Math.max(11, height * 0.06)}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${color}, ${opacity})`;
    const lineHeight = Math.max(13, height * 0.07);
    ctx.fillText(options.text ?? PK_DISCLAIMER_LINE_1, 0, -lineHeight / 2);
    ctx.fillText(PK_DISCLAIMER_LINE_2, 0, lineHeight / 2);
    ctx.restore();
  },
};

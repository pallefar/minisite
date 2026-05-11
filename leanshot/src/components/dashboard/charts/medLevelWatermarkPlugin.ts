/**
 * Chart.js per-instance plugin: diagonal watermark across the drug-level chart.
 *
 * Scope: ONLY MedLevelChart (D-14). Registered via `config.plugins: [medLevelWatermarkPlugin]`
 * on the MedLevelChart instance, NEVER via `Chart.register()` globally (which would
 * leak the watermark onto weight, symptom, and sparkline charts).
 *
 * Renders in `afterDraw` so the watermark is the LAST thing painted onto the canvas
 * (above the data line + legend). Phase 3's uncertainty band will use `beforeDraw`
 * so the band paints UNDER the line; this plugin's draw order is preserved.
 *
 * Text is verbatim per SC#3: 'Estimate — not medical advice' (em-dash U+2014).
 * Escape sequence — used to prevent hyphen auto-correction in editors.
 */
import type { Chart, Plugin } from 'chart.js';

const WATERMARK_TEXT = 'Estimate — not medical advice'; // U+2014 EM DASH — SC#3 verbatim

export interface MedLevelWatermarkOptions {
  /** RGB triplet string e.g. '60, 60, 60'. Default: '120, 120, 120'. */
  color?: string;
  /** 0..1. Default 0.12 (light theme); pass 0.18 for dark theme. */
  opacity?: number;
  /** Override text (testing only — production uses the verbatim SC#3 string). */
  text?: string;
  /** Override font family. */
  fontFamily?: string;
}

export const medLevelWatermarkPlugin: Plugin<'line', MedLevelWatermarkOptions> = {
  id: 'medLevelWatermark',
  afterDraw(chart: Chart<'line'>, _args, options: MedLevelWatermarkOptions) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const { left, top, width, height } = chartArea;
    const cx = left + width / 2;
    const cy = top + height / 2;
    const text = options.text ?? WATERMARK_TEXT;
    const opacity = options.opacity ?? 0.12;
    const color = options.color ?? '120, 120, 120';
    const fontFamily = options.fontFamily ?? 'Inter, system-ui, sans-serif';

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 4); // 45° counter-clockwise (D-13)
    ctx.font = `bold ${Math.max(14, height * 0.08)}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${color}, ${opacity})`;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  },
};

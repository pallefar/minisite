/**
 * Shared canvas helpers for the share-card templates.
 * Ported from v1 (leanshot.html:3552-3576).
 */

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface ShareData {
  name: string;
  medication: string;
  dose: string;
  doseUnit: string;
  weeks: number;
  startWeight: number;
  currentWeight: number;
  goalWeight: number;
  injections: number;
  bestStreak: number;
  units: 'metric' | 'imperial';
  nsv: string | null;
  /** Hex without '#' for the dominant accent — used by templates that allow customization. */
  accent?: string;
}

export type TemplateId = 'minimal' | 'bold' | 'milestone';

export interface Template {
  id: TemplateId;
  name: string;
  description: string;
  draw: (ctx: CanvasRenderingContext2D, data: ShareData) => void;
}

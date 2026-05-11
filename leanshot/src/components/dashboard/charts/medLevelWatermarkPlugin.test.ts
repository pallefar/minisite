import { describe, expect, it, vi } from 'vitest';
import { medLevelWatermarkPlugin } from './medLevelWatermarkPlugin';

function makeChart() {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    fillText: vi.fn(),
    font: '',
    textAlign: '',
    textBaseline: '',
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
  const chart = {
    ctx,
    chartArea: { left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 },
  };
  return { chart, ctx };
}

describe('medLevelWatermarkPlugin', () => {
  it('plugin id is "medLevelWatermark" (D-15)', () => {
    expect(medLevelWatermarkPlugin.id).toBe('medLevelWatermark');
  });

  it('draws the verbatim SC#3 watermark via fillText', () => {
    const { chart, ctx } = makeChart();
    medLevelWatermarkPlugin.afterDraw!(chart as never, {} as never, {});
    expect(ctx.fillText).toHaveBeenCalledWith(
      'Estimate — not medical advice', // U+2014 EM DASH
      0,
      0,
    );
  });

  it('rotates the canvas -45 degrees (Math.PI / 4)', () => {
    const { chart, ctx } = makeChart();
    medLevelWatermarkPlugin.afterDraw!(chart as never, {} as never, {});
    expect(ctx.rotate).toHaveBeenCalledWith(-Math.PI / 4);
  });

  it('calls save before drawing and restore after (proper canvas state hygiene)', () => {
    const { chart, ctx } = makeChart();
    medLevelWatermarkPlugin.afterDraw!(chart as never, {} as never, {});
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('honors the opacity option in the fillStyle', () => {
    const { chart, ctx } = makeChart();
    medLevelWatermarkPlugin.afterDraw!(chart as never, {} as never, {
      color: '60, 60, 60',
      opacity: 0.18,
    });
    // After the call, fillStyle should hold the last assigned value.
    expect(ctx.fillStyle).toBe('rgba(60, 60, 60, 0.18)');
  });

  it('bails when chartArea is undefined', () => {
    const ctx = { save: vi.fn(), fillText: vi.fn() } as unknown as CanvasRenderingContext2D;
    const chart = { ctx, chartArea: undefined };
    medLevelWatermarkPlugin.afterDraw!(chart as never, {} as never, {});
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });
});

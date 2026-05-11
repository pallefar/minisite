import { describe, expect, it, vi } from 'vitest';
import { PK_DISCLAIMER_LINE_1, PK_DISCLAIMER_LINE_2 } from '@/lib/disclaimers';
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
  it('plugin id is "medLevelWatermark-v2" (Phase 3 D-08)', () => {
    expect(medLevelWatermarkPlugin.id).toBe('medLevelWatermark-v2');
  });

  it('draws the Phase 3 two-line watermark via fillText (D-08)', () => {
    const { chart, ctx } = makeChart();
    medLevelWatermarkPlugin.afterDraw!(chart as never, {} as never, {});
    expect(ctx.fillText).toHaveBeenCalledWith(PK_DISCLAIMER_LINE_1, 0, expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith(PK_DISCLAIMER_LINE_2, 0, expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
  });

  it('PK_DISCLAIMER_LINE_2 starts with em-dash U+2014 (byte verification)', () => {
    expect(PK_DISCLAIMER_LINE_2.charCodeAt(0)).toBe(0x2014);
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

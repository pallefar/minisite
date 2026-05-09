/** Minimal — cream field, dark teal type, restrained typography. */
import { wrapText, type Template } from './renderer';

export const minimalTemplate: Template = {
  id: 'minimal',
  name: 'Minimal',
  description: 'Cream. Restrained. Quiet confidence.',
  draw(ctx, data) {
    const W = 540;
    const H = 960;
    const wU = data.units === 'metric' ? 'kg' : 'lb';
    const lost = data.startWeight - data.currentWeight;
    const lostAbs = Math.abs(lost);

    // Background — cream field
    ctx.fillStyle = '#EFEBE0';
    ctx.fillRect(0, 0, W, H);

    // Faint horizontal line near top
    ctx.strokeStyle = 'rgba(22,34,31,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(48, 96);
    ctx.lineTo(W - 48, 96);
    ctx.stroke();

    // Logo word
    ctx.fillStyle = '#1B4842';
    ctx.font = '700 22px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('LeanShot', 48, 80);
    ctx.fillStyle = 'rgba(22,34,31,0.5)';
    ctx.font = '500 16px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`week ${data.weeks}`, W - 48, 80);

    // Editorial label
    ctx.fillStyle = 'rgba(22,34,31,0.75)';
    ctx.font = 'italic 32px Fraunces, Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText(lost >= 0 ? 'Lost' : 'Gained', 48, H / 2 - 80);

    // Big number
    ctx.fillStyle = '#16221F';
    ctx.font = '800 180px Inter, -apple-system, sans-serif';
    const numText = lostAbs.toFixed(1);
    ctx.fillText(numText, 48, H / 2 + 60);
    const numWidth = ctx.measureText(numText).width;
    ctx.font = '600 48px Inter, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(22,34,31,0.5)';
    ctx.fillText(wU, 48 + numWidth + 12, H / 2 + 60);

    // 3 small stats below
    ctx.fillStyle = 'rgba(22,34,31,0.55)';
    ctx.font = '600 13px Inter, -apple-system, sans-serif';
    ctx.fillText(`${data.injections}`, 48, H / 2 + 130);
    ctx.font = '500 11px Inter, -apple-system, sans-serif';
    ctx.fillText('SHOTS', 48, H / 2 + 148);

    const goalLoss = data.startWeight - data.goalWeight;
    const goalPct = goalLoss > 0 ? Math.min(100, Math.max(0, Math.round((lost / goalLoss) * 100))) : 0;

    ctx.font = '600 13px Inter, -apple-system, sans-serif';
    ctx.fillText(`${goalPct}%`, 220, H / 2 + 130);
    ctx.font = '500 11px Inter, -apple-system, sans-serif';
    ctx.fillText('OF GOAL', 220, H / 2 + 148);

    ctx.font = '600 13px Inter, -apple-system, sans-serif';
    ctx.fillText(`${data.bestStreak}d`, 360, H / 2 + 130);
    ctx.font = '500 11px Inter, -apple-system, sans-serif';
    ctx.fillText('BEST STREAK', 360, H / 2 + 148);

    // NSV bottom
    if (data.nsv) {
      ctx.fillStyle = 'rgba(22,34,31,0.85)';
      ctx.font = 'italic 22px Fraunces, Georgia, serif';
      const wrapped = wrapText(ctx, `"${data.nsv}"`, W - 96);
      let yy = H - 260;
      wrapped.slice(0, 3).forEach((line) => {
        ctx.fillText(line, 48, yy);
        yy += 30;
      });
    }

    // Footer
    ctx.fillStyle = 'rgba(22,34,31,0.45)';
    ctx.font = '500 14px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('leanshot.app', W / 2, H - 48);
  },
};

/** Bold — the v1 template, refined. Deep teal field, editorial Fraunces label. */
import { roundRect, wrapText, type Template } from './renderer';

export const boldTemplate: Template = {
  id: 'bold',
  name: 'Bold',
  description: 'Editorial. Deep teal. Big number.',
  draw(ctx, data) {
    const W = 540;
    const H = 960;
    const wU = data.units === 'metric' ? 'kg' : 'lb';
    const lost = data.startWeight - data.currentWeight;
    const lostAbs = Math.abs(lost);
    const direction = lost >= 0 ? 'Lost' : 'Gained';
    const pct = data.startWeight > 0 ? (lost / data.startWeight) * 100 : 0;
    const goalLoss = data.startWeight - data.goalWeight;
    const goalPct = goalLoss > 0 ? Math.min(100, Math.max(0, Math.round((lost / goalLoss) * 100))) : 0;

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1B4842');
    bg.addColorStop(1, '#25564F');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Orbital rings
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(W / 2, H / 2 + 80, 220 + i * 60, 80 + i * 25, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Radial highlight
    const radial = ctx.createRadialGradient(W * 0.7, H * 0.25, 0, W * 0.7, H * 0.25, 400);
    radial.addColorStop(0, 'rgba(168,205,196,0.25)');
    radial.addColorStop(1, 'rgba(168,205,196,0)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, W, H);

    // Logo
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '700 28px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('LeanShot', 40, 60);

    // Pill
    const pillText = `${data.medication} · ${data.dose} ${data.doseUnit}`;
    ctx.font = '600 18px Inter, -apple-system, sans-serif';
    const pillW = ctx.measureText(pillText).width + 28;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    roundRect(ctx, 40, 90, pillW, 36, 18);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(pillText, 54, 114);

    // Editorial direction
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'italic 36px Fraunces, Georgia, serif';
    ctx.fillText(direction, 40, 240);

    // Big number
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 130px Inter, -apple-system, sans-serif';
    const numText = lostAbs.toFixed(1);
    ctx.fillText(numText, 40, 380);
    const numWidth = ctx.measureText(numText).width;
    ctx.font = '700 48px Inter, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(wU, 40 + numWidth + 14, 380);

    // Subtitle
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '500 22px Inter, -apple-system, sans-serif';
    ctx.fillText(`in ${data.weeks} week${data.weeks === 1 ? '' : 's'} · ${Math.abs(pct).toFixed(1)}%`, 40, 420);

    // Stats card
    const cardY = 480;
    const cardH = 130;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(ctx, 40, cardY, W - 80, cardH, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    roundRect(ctx, 40, cardY, W - 80, cardH, 20);
    ctx.stroke();

    const stats = [
      { label: 'GOAL', val: `${goalPct}%` },
      { label: 'SHOTS', val: data.injections.toString() },
      { label: 'BEST STREAK', val: `${data.bestStreak}d` },
    ];
    const colW = (W - 80) / 3;
    stats.forEach((s, i) => {
      const cx = 40 + colW * i + colW / 2;
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 38px Inter, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.val, cx, cardY + 60);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '600 14px Inter, -apple-system, sans-serif';
      ctx.fillText(s.label, cx, cardY + 90);
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(40 + colW, cardY + 28);
    ctx.lineTo(40 + colW, cardY + cardH - 28);
    ctx.moveTo(40 + colW * 2, cardY + 28);
    ctx.lineTo(40 + colW * 2, cardY + cardH - 28);
    ctx.stroke();

    if (data.nsv) {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = 'italic 22px Fraunces, Georgia, serif';
      ctx.textAlign = 'left';
      const wrapped = wrapText(ctx, `"${data.nsv}"`, W - 80);
      let yy = 700;
      wrapped.slice(0, 3).forEach((line) => {
        ctx.fillText(line, 40, yy);
        yy += 32;
      });
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '600 14px Inter, -apple-system, sans-serif';
      ctx.fillText('— NON-SCALE VICTORY', 40, yy + 6);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '500 16px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Made with LeanShot · leanshot.app', W / 2, H - 40);
  },
};

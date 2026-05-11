/** Milestone — celebratory but calm. Gradient with petal motif and big % */
import { roundRect, type Template } from './renderer';

export const milestoneTemplate: Template = {
  id: 'milestone',
  name: 'Milestone',
  description: 'For the big numbers. 10%, 30 days, etc.',
  draw(ctx, data) {
    const W = 540;
    const H = 960;
    const wU = data.units === 'metric' ? 'kg' : 'lb';
    const lost = data.startWeight - data.currentWeight;
    const lostAbs = Math.abs(lost);
    const pct = data.startWeight > 0 ? (lost / data.startWeight) * 100 : 0;

    // Background — soft warm gradient
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1B4842');
    bg.addColorStop(0.55, '#2F665E');
    bg.addColorStop(1, '#0F302C');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Glow
    const glow = ctx.createRadialGradient(W / 2, 360, 0, W / 2, 360, 380);
    glow.addColorStop(0, 'rgba(255,255,255,0.25)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Logo
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '700 24px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LeanShot', W / 2, 70);

    // Petal motif at top
    ctx.save();
    ctx.translate(W / 2, 220);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.moveTo(0, -90);
    ctx.bezierCurveTo(70, -50, 70, 50, 0, 90);
    ctx.bezierCurveTo(-70, 50, -70, -50, 0, -90);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Editorial label
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = 'italic 30px Fraunces, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('A milestone.', W / 2, 380);

    // Huge percent
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 200px Inter, -apple-system, sans-serif';
    ctx.fillText(`${Math.abs(pct).toFixed(1)}%`, W / 2, 560);

    // Subtitle
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = '500 22px Inter, -apple-system, sans-serif';
    ctx.fillText(`of body weight · ${lostAbs.toFixed(1)} ${wU} in ${data.weeks} weeks`, W / 2, 610);

    // Stats card
    const cardY = 680;
    const cardH = 110;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(ctx, 60, cardY, W - 120, cardH, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    roundRect(ctx, 60, cardY, W - 120, cardH, 18);
    ctx.stroke();

    const stats = [
      { label: 'SHOTS', val: data.injections.toString() },
      { label: 'STREAK', val: `${data.bestStreak}d` },
      { label: 'WEEK', val: data.weeks.toString() },
    ];
    const colW = (W - 120) / 3;
    stats.forEach((s, i) => {
      const cx = 60 + colW * i + colW / 2;
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 32px Inter, -apple-system, sans-serif';
      ctx.fillText(s.val, cx, cardY + 56);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = '600 12px Inter, -apple-system, sans-serif';
      ctx.fillText(s.label, cx, cardY + 84);
    });

    // Footer
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '500 16px Inter, -apple-system, sans-serif';
    ctx.fillText('Made with LeanShot · leanshot.app', W / 2, H - 48);
  },
};

// Tiny dependency-free confetti burst for winning settlements.
export function confetti(durationMs = 2600) {
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:200';
  c.width = innerWidth * devicePixelRatio;
  c.height = innerHeight * devicePixelRatio;
  document.body.appendChild(c);
  const ctx = c.getContext('2d')!;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const colors = ['#35d07f', '#ffd75e', '#4f8ff7', '#f7644f', '#e8ecf3'];
  const parts = Array.from({ length: 140 }, () => ({
    x: Math.random() * innerWidth,
    y: -20 - Math.random() * innerHeight * 0.5,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    vx: (Math.random() - 0.5) * 2.2,
    vy: 2 + Math.random() * 3.2,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.25,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(32, now - (tick as any).last || 16) / 16.7; (tick as any).last = now;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.vy += 0.04 * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - (now - t0) / durationMs);
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (now - t0 < durationMs) requestAnimationFrame(tick);
    else c.remove();
  };
  requestAnimationFrame(tick);
}

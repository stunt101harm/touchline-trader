// Canvas share card: "1,000 → 1,222 coins trading ENG–ARG" over the match price line.
import type { Outcome, TapeBundle } from '../shared/types';
import { OUTCOMES } from '../shared/types';

export function renderShareCard(opts: {
  tape: TapeBundle;
  endCash: number;
  rank?: string;
}): HTMLCanvasElement {
  const { tape, endCash } = opts;
  const W = 1200, H = 630;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d')!;

  // background
  x.fillStyle = '#0b0e14';
  x.fillRect(0, 0, W, H);
  const grad = x.createRadialGradient(W / 2, -100, 50, W / 2, 0, 700);
  grad.addColorStop(0, 'rgba(79,143,247,.18)');
  grad.addColorStop(1, 'transparent');
  x.fillStyle = grad;
  x.fillRect(0, 0, W, H);

  // winner price line across the match
  const winner: Outcome = tape.final?.winner ?? 'home';
  const wi = OUTCOMES.indexOf(winner);
  const ticks = tape.ticks;
  if (ticks.length > 2) {
    const t0 = ticks[0].t, t1 = ticks[ticks.length - 1].t;
    const px = (t: number) => 80 + ((t - t0) / (t1 - t0)) * (W - 160);
    const py = (p: number) => 500 - (p / 100) * 300;
    x.beginPath();
    const step = Math.max(1, Math.floor(ticks.length / 400));
    for (let i = 0; i < ticks.length; i += step) {
      const tk = ticks[i];
      i === 0 ? x.moveTo(px(tk.t), py(tk.p[wi])) : x.lineTo(px(tk.t), py(tk.p[wi]));
    }
    x.strokeStyle = winner === 'away' ? '#f7644f' : winner === 'draw' ? '#8b93a3' : '#4f8ff7';
    x.lineWidth = 5;
    x.lineJoin = 'round';
    x.globalAlpha = 0.9;
    x.stroke();
    x.globalAlpha = 1;
  }

  const center = (txt: string, y: number, font: string, color: string) => {
    x.font = font; x.fillStyle = color; x.textAlign = 'center'; x.fillText(txt, W / 2, y);
  };
  const sys = '-apple-system, Segoe UI, Roboto, sans-serif';
  center('TOUCHLINE TRADER', 90, `700 34px ${sys}`, '#5c6470');
  const pnl = endCash - 1000;
  center(`1,000 → ${Math.round(endCash).toLocaleString()} coins`, 190, `800 76px ${sys}`, pnl >= 0 ? '#35d07f' : '#ff5c5c');
  const fin = tape.final ? ` ${tape.final.home}–${tape.final.away} ` : ' v ';
  center(`trading ${tape.home}${fin}${tape.away}`, 260, `600 40px ${sys}`, '#e8ecf3');
  if (opts.rank) center(opts.rank, 320, `600 30px ${sys}`, '#ffd75e');
  center('trade the match like a stock · free to play', 560, `500 28px ${sys}`, '#5c6470');
  center('touchline-trader.h-dhaliwal2250.workers.dev', 600, `600 26px ${sys}`, '#4f8ff7');
  return c;
}

export async function shareCard(canvas: HTMLCanvasElement, text: string) {
  const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/png'));
  if (!blob) return;
  const file = new File([blob], 'touchline-result.png', { type: 'image/png' });
  const nav = navigator as any;
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], text }); return; } catch { /* cancelled */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'touchline-result.png';
  a.click();
  URL.revokeObjectURL(a.href);
}

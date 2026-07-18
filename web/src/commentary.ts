// "The Floor" — a rule-based market commentator. Personality without dependencies:
// every line is derived from the tick/event stream, so it works identically in
// replay and live, offline, and for every judge.
import type { DangerSpan, MatchEvent, Outcome, Tick } from '../shared/types';
import { OUTCOMES } from '../shared/types';

export interface FloorLine {
  text: string;
  tone: 'calm' | 'tense' | 'wild';
}

interface Names { home: string; away: string }

const pct = (v: number) => `${Math.round(v)}¢`;

export class FloorCommentator {
  private history: Tick[] = [];
  private lastEmitReal = 0;
  private lastTone: FloorLine['tone'] = 'calm';
  private variant = 0;
  private clockSec = 0;
  private score: [number, number] = [0, 0];

  constructor(private names: Names, private onLine: (line: FloorLine) => void) {}

  private emit(text: string, tone: FloorLine['tone'], minGapMs = 9000, force = false) {
    const now = performance.now();
    if (!force && now - this.lastEmitReal < minGapMs) return;
    this.lastEmitReal = now;
    this.lastTone = tone;
    this.onLine({ text, tone });
  }

  private pick(lines: string[]): string {
    this.variant = (this.variant + 1) % 997;
    return lines[this.variant % lines.length];
  }

  private outcomeName(o: Outcome): string {
    return o === 'home' ? this.names.home : o === 'away' ? this.names.away : 'the draw';
  }

  onClock(sec: number) { this.clockSec = sec; }
  onScore(s: [number, number]) { this.score = s; }

  onTick(tick: Tick) {
    this.history.push(tick);
    if (this.history.length < 2) return;
    // compare against ~2 minutes of tape time earlier
    const cutoff = tick.t - 120_000;
    let past = this.history[0];
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].t <= cutoff) { past = this.history[i]; break; }
    }
    if (this.history.length > 4000) this.history.splice(0, 2000);

    let biggest: Outcome | null = null;
    let delta = 0;
    OUTCOMES.forEach((o, i) => {
      const d = tick.p[i] - past.p[i];
      if (Math.abs(d) > Math.abs(delta)) { delta = d; biggest = o; }
    });
    if (biggest && Math.abs(delta) >= 5) {
      const name = this.outcomeName(biggest);
      const i = OUTCOMES.indexOf(biggest);
      if (delta > 0) {
        this.emit(this.pick([
          `Money is pouring into ${name} — ${pct(past.p[i])} → ${pct(tick.p[i])} in minutes.`,
          `The floor likes ${name}. Price surging to ${pct(tick.p[i])}.`,
          `Someone knows something — ${name} bid up hard to ${pct(tick.p[i])}.`,
        ]), 'tense', 15000);
      } else {
        this.emit(this.pick([
          `${name} money is running for the exits — down to ${pct(tick.p[i])}.`,
          `Confidence in ${name} is evaporating: ${pct(past.p[i])} → ${pct(tick.p[i])}.`,
          `The market is quietly giving up on ${name}.`,
        ]), 'tense', 15000);
      }
      return;
    }

    // draw-grind narrative in a level game after the hour
    const drawP = tick.p[1];
    if (this.score[0] === this.score[1] && this.clockSec > 3600 && drawP > 42) {
      this.emit(this.pick([
        `The draw is quietly eating everything — stalemate money piling in at ${pct(drawP)}.`,
        `Nobody blinks. The draw creeps to ${pct(drawP)} and the clock is its friend.`,
      ]), 'calm', 45000);
      return;
    }

    // late-game survival narrative
    const leadIdx = tick.p.indexOf(Math.max(...tick.p));
    if (this.clockSec > 4800 && tick.p[leadIdx] > 75 && OUTCOMES[leadIdx] !== 'draw') {
      this.emit(this.pick([
        `${this.outcomeName(OUTCOMES[leadIdx])} just need to survive — every clearance is worth a cent.`,
        `${pct(tick.p[leadIdx])} and climbing. The market is already writing the headlines.`,
      ]), 'calm', 45000);
    }
  }

  onDanger(d: DangerSpan) {
    if (d.state !== 'high_danger' || d.team === 0) return;
    const name = d.team === 1 ? this.names.home : this.names.away;
    this.emit(this.pick([
      `${name} are camped in the box — the market is holding its breath.`,
      `Hearts in mouths. ${name} threatening, and the tape has gone twitchy.`,
      `Danger. ${name} sense it, and so does the money.`,
    ]), 'wild', 20000);
  }

  onEvent(ev: MatchEvent, latest: Tick | null) {
    const name = ev.team === 1 ? this.names.home : ev.team === 2 ? this.names.away : '';
    switch (ev.kind) {
      case 'kickoff':
        this.emit(this.pick([
          'Markets open. Ninety minutes. No mercy.',
          'We are live. May your entries be early and your exits be greedy.',
        ]), 'calm', 0, true);
        break;
      case 'goal': {
        const target = ev.team === 1 ? 0 : ev.team === 2 ? 2 : null;
        const px = latest && target != null ? ` — repriced to ${pct(latest.p[target])}` : '';
        this.emit(this.pick([
          `BOOM. ${name} detonate the market${px}.`,
          `GOAL ${name}! The candle you tell your grandkids about.`,
          `${name} score, and a thousand positions change hands in a heartbeat.`,
        ]), 'wild', 0, true);
        break;
      }
      case 'red_card':
        this.emit(`Down to ten. The market shows no mercy to ${name}.`, 'wild', 0, true);
        break;
      case 'var':
        this.emit(this.pick([
          'VAR. The three most profitable letters in football — if you guess right.',
          'The screen. The wait. The whole market frozen mid-breath.',
        ]), 'tense', 0, true);
        break;
      case 'halftime':
        this.emit(this.pick([
          'Half-time. Breathe. Reassess. The tape never lies, but it does tease.',
          'Forty-five gone. The market grabs an orange slice.',
        ]), 'calm', 0, true);
        break;
      case 'fulltime':
        this.emit('Full time. Positions settled, stories written. See you at the next market.', 'calm', 0, true);
        break;
      case 'penalty':
        this.emit(`Penalty! ${name} step up — fortunes decided from twelve yards.`, 'wild', 0, true);
        break;
    }
  }
}

// Session-clock replay driver. One tape, one local clock — every judge replays independently.
import type { DangerSpan, MatchEvent, TapeBundle, Tick } from '../shared/types';

export interface ReplayCallbacks {
  onTick?: (tick: Tick) => void;
  onEvent?: (ev: MatchEvent) => void;
  onDanger?: (d: DangerSpan) => void;
  onTime?: (t: number, progress: number) => void; // progress 0-1
  onEnd?: () => void;
}

/** Session time bounds for a tape — start shortly before kickoff, end at the last event/tick. */
export function tapeBounds(tape: TapeBundle): { t0: number; t1: number } {
  const t0 = Math.max(tape.ticks[0]?.t ?? tape.kickoff, tape.kickoff - 10 * 60 * 1000);
  const lastEv = tape.events[tape.events.length - 1]?.t ?? tape.kickoff;
  const lastTick = tape.ticks[tape.ticks.length - 1]?.t ?? lastEv;
  return { t0, t1: Math.max(lastEv, lastTick) };
}

export class ReplayClock {
  readonly tape: TapeBundle;
  speed = 10;
  private cb: ReplayCallbacks;
  private t: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastReal = 0;
  private running = false;
  private tickIdx = 0;
  private evIdx = 0;
  private dgIdx = 0;
  readonly t0: number;
  readonly t1: number;

  constructor(tape: TapeBundle, cb: ReplayCallbacks) {
    this.tape = tape;
    this.cb = cb;
    const { t0, t1 } = tapeBounds(tape);
    this.t0 = t0;
    this.t1 = t1;
    this.t = this.t0;
    this.syncIndices();
  }

  get now(): number { return this.t; }
  get progress(): number { return (this.t - this.t0) / (this.t1 - this.t0); }
  get isRunning(): boolean { return this.running; }

  /** Latest tick at-or-before the current session clock (fill price source). */
  currentTick(): Tick | null {
    const i = this.tickIdx - 1;
    return i >= 0 ? this.tape.ticks[i] : null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastReal = performance.now();
    // interval-driven, not rAF: rAF stalls under tab throttling / battery savers,
    // which would freeze the match clock. 100ms steps keep chart updates coalesced.
    this.timer = setInterval(() => {
      if (!this.running) return;
      const nowReal = performance.now();
      // cap the step so a heavily-throttled or backgrounded tab resumes where it
      // left off instead of leaping forward by the entire time away
      const dt = Math.min(nowReal - this.lastReal, 1000) * this.speed;
      this.lastReal = nowReal;
      this.advance(dt);
      if (this.t >= this.t1) {
        this.pause();
        this.cb.onEnd?.();
      }
    }, 100);
  }

  pause() {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  seek(fraction: number) {
    // clamp shy of the end so the fulltime event always plays out through advance()
    // (seeking exactly to t1 would sync indices past FT and strand the match unsettled)
    this.t = this.t0 + Math.min(0.995, Math.max(0, fraction)) * (this.t1 - this.t0);
    this.syncIndices();
    // replay the latest tick so UI prices refresh immediately
    const tk = this.currentTick();
    if (tk) this.cb.onTick?.(tk);
    this.cb.onTime?.(this.t, this.progress);
  }

  private syncIndices() {
    const { ticks, events, danger } = this.tape;
    this.tickIdx = lowerBound(ticks, this.t);
    this.evIdx = lowerBound(events, this.t);
    this.dgIdx = lowerBound(danger, this.t);
  }

  private advance(dtMs: number) {
    this.t += dtMs;
    const { ticks, events, danger } = this.tape;
    // at high speed, coalesce: deliver at most the last tick of the burst to the UI,
    // but every event (events are the drama)
    let lastTick: Tick | null = null;
    while (this.tickIdx < ticks.length && ticks[this.tickIdx].t <= this.t) {
      lastTick = ticks[this.tickIdx++];
      if (this.speed <= 4) this.cb.onTick?.(lastTick);
    }
    if (this.speed > 4 && lastTick) this.cb.onTick?.(lastTick);
    while (this.evIdx < events.length && events[this.evIdx].t <= this.t) {
      this.cb.onEvent?.(events[this.evIdx++]);
    }
    while (this.dgIdx < danger.length && danger[this.dgIdx].t <= this.t) {
      this.cb.onDanger?.(danger[this.dgIdx++]);
    }
    this.cb.onTime?.(this.t, this.progress);
  }
}

function lowerBound(arr: { t: number }[], t: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t <= t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

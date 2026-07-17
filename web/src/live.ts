// Live feed driver — polls the worker's incremental event endpoint every 2s.
// Same callback surface as ReplayClock so the session UI treats both alike.
import type { DangerSpan, MatchEvent, Outcome, Tick } from '../shared/types';

export interface LiveMatch {
  fixture_id: number;
  home: string;
  away: string;
  kickoff: number;
  status: 'upcoming' | 'live' | 'finished';
  winner: Outcome | null;
  reg_home: number | null;
  reg_away: number | null;
}

export interface LiveCallbacks {
  onTick?: (tick: Tick) => void;
  onEvent?: (ev: MatchEvent) => void;
  onDanger?: (d: DangerSpan) => void;
  onMeta?: (m: LiveMatch) => void;
  onFinal?: (m: LiveMatch) => void;
}

export class LiveFeed {
  private cursor = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: Tick | null = null;
  private finalFired = false;
  match: LiveMatch | null = null;

  constructor(readonly fixtureId: number, private cb: LiveCallbacks) {}

  currentTick(): Tick | null { return this.last; }

  async start() {
    await this.poll(); // backlog
    this.timer = setInterval(() => this.poll().catch(() => {}), 2000);
  }

  stop() { if (this.timer) clearInterval(this.timer); }

  private async poll() {
    const r = await fetch(`/api/live/${this.fixtureId}/events?after=${this.cursor}`);
    if (!r.ok) return;
    const { match, events } = await r.json() as { match: LiveMatch | null; events: { id: number; type: string; payload: string }[] };
    for (const row of events) {
      this.cursor = Math.max(this.cursor, row.id);
      let p: any;
      try { p = JSON.parse(row.payload); } catch { continue; }
      if (row.type === 'tick') { this.last = p; this.cb.onTick?.(p); }
      else if (row.type === 'event') this.cb.onEvent?.(p);
      else if (row.type === 'danger') this.cb.onDanger?.(p);
    }
    if (match) {
      this.match = match;
      this.cb.onMeta?.(match);
      if (match.status === 'finished' && match.winner && !this.finalFired) {
        this.finalFired = true;
        this.cb.onFinal?.(match);
      }
    }
  }
}

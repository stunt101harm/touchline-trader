// Deterministic rival traders. Driven purely by the tick/event stream, so every judge's
// replay produces identical bot behaviour — no server, no randomness.
import type { DangerSpan, MatchEvent, Outcome, Tick } from '../shared/types';
import { OUTCOMES } from '../shared/types';
import { buy, sell, settle, equity, newPortfolio, type Portfolio } from '../shared/engine';

export interface BotState {
  name: string;
  emoji: string;
  pf: Portfolio;
  entry: Partial<Record<Outcome, number>>; // price at (latest) entry
}

interface BotDef {
  name: string;
  emoji: string;
  onTick?: (b: BotState, tick: Tick, idx: number, history: Tick[]) => void;
  onDanger?: (b: BotState, d: DangerSpan, tick: Tick | null) => void;
  onEvent?: (b: BotState, ev: MatchEvent, tick: Tick | null) => void;
}

const px = (t: Tick, o: Outcome) => t.p[OUTCOMES.indexOf(o)];
const tryBuy = (b: BotState, o: Outcome, coins: number, t: Tick) => {
  const r = buy(b.pf, o, Math.min(coins, b.pf.cash), px(t, o), t.t);
  if (typeof r !== 'string') b.entry[o] = px(t, o);
};
const tryExit = (b: BotState, o: Outcome, t: Tick) => {
  if (b.pf.positions[o].shares > 0) sell(b.pf, o, 1, px(t, o), t.t);
};

const DEFS: BotDef[] = [
  {
    name: 'Momentum Mike', emoji: '🏇',
    onTick(b, tick, idx, hist) {
      if (idx < 40 || idx % 25 !== 0) return;
      const past = hist[idx - 40];
      for (const o of OUTCOMES) {
        const rise = px(tick, o) - px(past, o);
        if (rise > 3 && b.pf.cash >= 100) tryBuy(b, o, 100, tick);
        const e = b.entry[o];
        if (e != null && px(tick, o) < e - 5) tryExit(b, o, tick);
      }
    },
  },
  {
    name: 'Contrarian Cara', emoji: '🦉',
    onTick(b, tick, idx, hist) {
      if (idx < 60 || idx % 40 !== 0) return;
      const past = hist[idx - 60];
      let worst: Outcome | null = null, worstDrop = -Infinity;
      for (const o of OUTCOMES) {
        const drop = px(past, o) - px(tick, o);
        if (drop > worstDrop) { worstDrop = drop; worst = o; }
      }
      if (worst && worstDrop > 5 && b.pf.cash >= 120) tryBuy(b, worst, 120, tick);
    },
  },
  {
    name: 'Danger Dave', emoji: '🔥',
    onDanger(b, d, tick) {
      if (!tick || d.state !== 'high_danger' || d.team === 0) return;
      const o: Outcome = d.team === 1 ? 'home' : 'away';
      if (b.pf.cash >= 80) tryBuy(b, o, 80, tick);
    },
    onEvent(b, ev, tick) {
      if (tick && ev.kind === 'halftime') for (const o of OUTCOMES) tryExit(b, o, tick);
    },
  },
  {
    name: 'Diamond Dana', emoji: '💎',
    onTick(b, tick, idx) {
      if (idx !== 5) return; // one decisive pre-match buy of the favourite, never sells
      const fav = OUTCOMES.reduce((a, o) => (px(tick, o) > px(tick, a) ? o : a), 'home' as Outcome);
      tryBuy(b, fav, 400, tick);
    },
  },
  {
    name: 'Panic Pete', emoji: '😱',
    onTick(b, tick, idx) {
      if (idx % 15 !== 0) return;
      for (const o of OUTCOMES) {
        const e = b.entry[o];
        if (e != null && b.pf.positions[o].shares > 0 && px(tick, o) < e - 2) tryExit(b, o, tick);
      }
      if (idx % 45 === 0 && b.pf.cash >= 60) {
        const fav = OUTCOMES.reduce((a, o) => (px(tick, o) > px(tick, a) ? o : a), 'home' as Outcome);
        tryBuy(b, fav, 60, tick);
      }
    },
  },
];

export class BotEngine {
  bots: BotState[];
  private history: Tick[] = [];
  private lastTick: Tick | null = null;

  constructor() {
    this.bots = DEFS.map(d => ({ name: d.name, emoji: d.emoji, pf: newPortfolio(), entry: {} }));
  }

  onTick(tick: Tick) {
    this.history.push(tick);
    this.lastTick = tick;
    const idx = this.history.length - 1;
    DEFS.forEach((d, i) => d.onTick?.(this.bots[i], tick, idx, this.history));
  }

  onDanger(d: DangerSpan) {
    DEFS.forEach((def, i) => def.onDanger?.(this.bots[i], d, this.lastTick));
  }

  onEvent(ev: MatchEvent) {
    DEFS.forEach((def, i) => def.onEvent?.(this.bots[i], ev, this.lastTick));
  }

  settleAll(winner: Outcome) {
    for (const b of this.bots) settle(b.pf, winner);
  }

  /** Standings including the human player, best equity first. */
  standings(you: Portfolio, youName: string): { name: string; emoji: string; eq: number; you?: boolean }[] {
    const t = this.lastTick;
    const rows = this.bots.map(b => ({ name: b.name, emoji: b.emoji, eq: equity(b.pf, t) }));
    rows.push({ name: youName, emoji: '🫵', eq: equity(you, t), you: true } as any);
    return rows.sort((a, b) => b.eq - a.eq);
  }
}

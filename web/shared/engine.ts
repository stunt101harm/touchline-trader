// Pure trading engine. Long-only, close-only; prices are implied % (coins per share, share pays 100).
// Session-clock based: callers supply the price at their own clock position (live = latest, replay = tape position).
import type { Outcome, Tick } from './types';
import { OUTCOMES } from './types';

export const STARTING_CASH = 1000;
export const MIN_TRADE = 10;

export interface Position {
  shares: number;      // fractional shares; each pays 100 coins if outcome wins
  cost: number;        // total coins spent on open shares
}

export interface Portfolio {
  cash: number;
  positions: Record<Outcome, Position>;
  realized: number;    // realized P&L from closes
  settled: boolean;
}

export interface Fill {
  t: number;
  outcome: Outcome;
  side: 'buy' | 'sell';
  shares: number;
  price: number;       // implied % at fill
  coins: number;       // coins moved
}

export function newPortfolio(): Portfolio {
  return {
    cash: STARTING_CASH,
    positions: { home: { shares: 0, cost: 0 }, draw: { shares: 0, cost: 0 }, away: { shares: 0, cost: 0 } },
    realized: 0,
    settled: false,
  };
}

export function priceOf(tick: Tick, outcome: Outcome): number {
  return tick.p[OUTCOMES.indexOf(outcome)];
}

/** Spend `coins` buying `outcome` at `price` (implied %). Returns the fill or an error string. */
export function buy(pf: Portfolio, outcome: Outcome, coins: number, price: number, t: number): Fill | string {
  if (pf.settled) return 'market settled';
  if (!(price > 0.5 && price < 99.5)) return 'market unavailable';
  if (coins < MIN_TRADE) return `minimum trade is ${MIN_TRADE} coins`;
  if (coins > pf.cash) return 'not enough coins';
  const shares = coins / price;
  pf.cash -= coins;
  const pos = pf.positions[outcome];
  pos.shares += shares;
  pos.cost += coins;
  return { t, outcome, side: 'buy', shares, price, coins };
}

/** Close `fraction` (0-1] of the open position at `price`. Sell = close only — no shorting. */
export function sell(pf: Portfolio, outcome: Outcome, fraction: number, price: number, t: number): Fill | string {
  if (pf.settled) return 'market settled';
  const pos = pf.positions[outcome];
  if (pos.shares <= 0) return 'no position to sell';
  const f = Math.min(1, Math.max(0, fraction));
  if (f <= 0) return 'nothing to sell';
  const shares = pos.shares * f;
  const coins = shares * price;
  const costOut = pos.cost * f;
  pos.shares -= shares;
  pos.cost -= costOut;
  if (pos.shares < 1e-9) { pos.shares = 0; pos.cost = 0; }
  pf.cash += coins;
  pf.realized += coins - costOut;
  return { t, outcome, side: 'sell', shares, price, coins };
}

/** Settle every position: winner pays 100/share, others 0. */
export function settle(pf: Portfolio, winner: Outcome): void {
  if (pf.settled) return;
  for (const o of OUTCOMES) {
    const pos = pf.positions[o];
    if (pos.shares > 0) {
      const payout = o === winner ? pos.shares * 100 : 0;
      pf.cash += payout;
      pf.realized += payout - pos.cost;
      pos.shares = 0;
      pos.cost = 0;
    }
  }
  pf.settled = true;
}

/** Mark-to-market total value at the given tick. */
export function equity(pf: Portfolio, tick: Tick | null): number {
  let v = pf.cash;
  if (tick) for (const o of OUTCOMES) v += pf.positions[o].shares * priceOf(tick, o);
  else for (const o of OUTCOMES) v += pf.positions[o].cost;
  return v;
}

export function unrealized(pf: Portfolio, tick: Tick | null): number {
  if (!tick) return 0;
  let v = 0;
  for (const o of OUTCOMES) {
    const pos = pf.positions[o];
    if (pos.shares > 0) v += pos.shares * priceOf(tick, o) - pos.cost;
  }
  return v;
}

/** Binary-search the tape for the latest tick at-or-before time t (session clock). */
export function tickAt(ticks: Tick[], t: number): Tick | null {
  if (!ticks.length || t < ticks[0].t) return null;
  let lo = 0, hi = ticks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ticks[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  return ticks[lo];
}

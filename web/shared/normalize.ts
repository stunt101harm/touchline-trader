// TxLINE payload -> internal schema. Field names verified against live captures (docs/field-inventory.md).
import type { DangerSpan, MatchEvent, Tick } from './types';

export const STABLE_BOOK = 'TXLineStablePriceDemargined';
export const WINNER_MARKET = '1X2_PARTICIPANT_RESULT';

/** Odds update -> Tick. Returns null for non-1X2 / non-full-match / other-bookmaker updates. */
export function oddsToTick(o: any, fixtureId?: number): Tick | null {
  if (!o || (fixtureId && o.FixtureId !== fixtureId)) return null;
  if (o.Bookmaker !== STABLE_BOOK || o.SuperOddsType !== WINNER_MARKET) return null;
  if (o.MarketPeriod != null) return null; // full-match market only (halves excluded)
  const names: string[] = o.PriceNames ?? [];
  const pct: string[] = o.Pct ?? [];
  if (names.length !== 3 || pct.length !== 3) return null;
  const by: Record<string, number> = {};
  names.forEach((n, i) => { by[n] = parseFloat(pct[i]); });
  const home = by['part1'], draw = by['draw'], away = by['part2'];
  if (![home, draw, away].every(Number.isFinite)) return null;
  return { t: o.Ts, p: [home, draw, away] };
}

const DANGER_MAP: Record<string, DangerSpan['state']> = {
  safe_possession: 'safe',
  attack_possession: 'attack',
  danger_possession: 'danger',
  high_danger_possession: 'high_danger',
};

const EVENT_MAP: Record<string, MatchEvent['kind']> = {
  goal: 'goal',
  yellow_card: 'yellow_card',
  red_card: 'red_card',
  var: 'var',
  shot: 'shot',
  corner: 'corner',
  substitution: 'substitution',
  kickoff: 'kickoff',
  additional_time: 'additional_time',
};

export interface ScoreParse {
  event?: MatchEvent;
  danger?: DangerSpan;
  final?: boolean; // game_finalised seen
  score?: [number, number];
}

/** Score stream/history payload -> normalized event/danger/status. */
export function parseScoreEvent(s: any, fixtureId?: number): ScoreParse | null {
  if (!s || (fixtureId && s.FixtureId !== fixtureId)) return null;
  const action: string = s.Action ?? '';
  const t: number = s.Ts;
  const team = (s.Participant === 1 ? 1 : s.Participant === 2 ? 2 : 0) as 0 | 1 | 2;
  const clockSec: number | undefined = s.Clock?.Seconds;
  const score = extractScore(s);

  const out: ScoreParse = {};
  if (score) out.score = score;

  const danger = DANGER_MAP[action];
  if (danger) { out.danger = { t, state: danger, team }; return out; }

  if (action === 'game_finalised') { out.final = true; return out; }
  if (action === 'halftime_finalised') { out.event = { t, kind: 'halftime', team: 0, clockSec }; return out; }

  const kind = EVENT_MAP[action];
  if (kind) {
    const note = typeof s.Data === 'object' && s.Data ? summarizeData(s.Data) : undefined;
    out.event = { t, kind, team, clockSec, note, score: score ?? undefined };
    return out;
  }
  return score ? out : null;
}

/** Total running goals [p1, p2] from the verified Score shape: {Participant1:{Total:{Goals}},…}. */
function extractScore(s: any): [number, number] | null {
  const sc = s.Score;
  if (!sc || typeof sc !== 'object') return null;
  const g = (p: any) => p?.Total?.Goals ?? 0;
  if (!sc.Participant1 && !sc.Participant2) return null;
  return [g(sc.Participant1), g(sc.Participant2)];
}

/**
 * Regulation-time goals [p1, p2] — H1+H2 only, excluding ET1/ET2/shootout.
 * The 1X2_PARTICIPANT_RESULT market settles on the 90-minute result: a regulation
 * draw settles 'draw' even if the match is decided in extra time or on penalties.
 */
export function regulationScore(s: any): [number, number] {
  const sc = s?.Score ?? {};
  const g = (p: any) => (p?.H1?.Goals ?? 0) + (p?.H2?.Goals ?? 0);
  return [g(sc.Participant1), g(sc.Participant2)];
}

function summarizeData(d: any): string | undefined {
  const keys = Object.keys(d);
  if (!keys.length) return undefined;
  return keys.slice(0, 3).join(' ');
}

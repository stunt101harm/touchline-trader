// Canonical internal schema — designed from real captured TxLINE payloads (docs/field-inventory.md).

export type Outcome = 'home' | 'draw' | 'away';
export const OUTCOMES: Outcome[] = ['home', 'draw', 'away'];

/** One consensus price tick: implied probabilities (0-100) per outcome. */
export interface Tick {
  t: number; // ms epoch (receive/exchange time)
  p: [number, number, number]; // [home, draw, away] implied %, demargined (TxLINE Pct)
}

export type EventKind =
  | 'goal' | 'yellow_card' | 'red_card' | 'var' | 'shot' | 'corner'
  | 'penalty' | 'substitution' | 'kickoff' | 'halftime' | 'fulltime'
  | 'additional_time' | 'suspension';

export interface MatchEvent {
  t: number;            // ms epoch
  kind: EventKind;
  team: 0 | 1 | 2;      // 0 = neutral/unknown, 1 = home, 2 = away
  clockSec?: number;    // match clock at the event
  note?: string;        // e.g. "Header", "VAR check", "+4min"
  score?: [number, number]; // running score after the event when known
}

export type DangerState = 'safe' | 'attack' | 'danger' | 'high_danger';

export interface DangerSpan {
  t: number;
  state: DangerState;
  team: 0 | 1 | 2;
}

export interface TapeBundle {
  fixtureId: number;
  home: string;
  away: string;
  kickoff: number;              // ms epoch
  final?: { home: number; away: number; winner: Outcome };
  ticks: Tick[];                // ascending t
  events: MatchEvent[];         // ascending t
  danger: DangerSpan[];         // ascending t
  meta: { source: 'recorded' | 'historical'; compiledAt: number; label?: string };
}

export interface TapeManifestEntry {
  fixtureId: number;
  home: string;
  away: string;
  kickoff: number;
  label: string;                // "Semi-final", "Quarter-final", ...
  final?: { home: number; away: number; winner: Outcome };
  tickCount: number;
  eventCount: number;
  featured?: boolean;
}

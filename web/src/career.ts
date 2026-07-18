// Local career record — every settled session, best runs, lifetime P&L.
export interface CareerEntry {
  fixtureId: number;
  match: string;
  pnl: number;
  mode: 'replay' | 'live';
  ts: number;
}

const KEY = 'tt-career';

export function recordResult(e: CareerEntry) {
  const all = getCareer();
  all.push(e);
  localStorage.setItem(KEY, JSON.stringify(all.slice(-200)));
}

export function getCareer(): CareerEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export interface CareerSummary {
  matches: number;
  total: number;
  wins: number;
  best: CareerEntry | null;
}

export function careerSummary(): CareerSummary {
  const all = getCareer();
  return {
    matches: all.length,
    total: all.reduce((s, e) => s + e.pnl, 0),
    wins: all.filter(e => e.pnl > 0).length,
    best: all.reduce<CareerEntry | null>((b, e) => (b === null || e.pnl > b.pnl ? e : b), null),
  };
}

// ---- challenge rooms ----------------------------------------------------

export function currentRoom(): string | null {
  return sessionStorage.getItem('tt-room') ?? new URLSearchParams(location.search).get('room');
}

export function setRoom(code: string) {
  sessionStorage.setItem('tt-room', code.toUpperCase());
}

export function makeRoomCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function roomLink(code: string, fixtureId: number): string {
  return `${location.origin}/?match=${fixtureId}&room=${code}`;
}

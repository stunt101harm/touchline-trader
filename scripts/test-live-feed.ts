// Live-mode rehearsal: replay a compiled tape INTO /api/ingest at speed, as if the match
// were happening now. Validates worker ingest -> D1 -> LiveSession end to end without a live match.
// Run: npx tsx --env-file=.env.ingest scripts/test-live-feed.ts [speed=60] [appUrl]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SPEED = Number(process.argv[2] ?? 60);
const APP = process.argv[3] ?? 'http://localhost:5199';
const KEY = process.env.INGEST_KEY!;
const FIXTURE = 99999;

const tape = JSON.parse(readFileSync(fileURLToPath(new URL('../web/public/tapes/18241006.json', import.meta.url)), 'utf8'));
type Item = { t: number; type: 'tick' | 'event' | 'danger'; payload: any };
const items: Item[] = [
  ...tape.ticks.map((p: any) => ({ t: p.t, type: 'tick' as const, payload: p })),
  ...tape.events.map((p: any) => ({ t: p.t, type: 'event' as const, payload: p })),
  ...tape.danger.map((p: any) => ({ t: p.t, type: 'danger' as const, payload: p })),
].sort((a, b) => a.t - b.t);

const t0 = items[0].t;
const start = Date.now();
const remap = (t: number) => start + (t - t0) / SPEED;
let idx = 0;

async function post(body: any) {
  const r = await fetch(`${APP}/api/ingest`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-key': KEY },
    body: JSON.stringify({ fixtureId: FIXTURE, ...body }),
  });
  if (!r.ok) console.error('ingest', r.status, await r.text());
}

console.log(`feeding ${items.length} items at ${SPEED}x to ${APP} as fixture ${FIXTURE}`);
await post({ meta: { home: 'Testland', away: 'Demoria', kickoff: remap(tape.kickoff), status: 'upcoming' } });

let kickoffSent = false;
const iv = setInterval(async () => {
  const now = Date.now();
  const batch: Item[] = [];
  while (idx < items.length && remap(items[idx].t) <= now) {
    const it = items[idx++];
    // remap payload timestamps so the UI clock/chart run in "now" time
    const p = { ...it.payload, t: Math.round(remap(it.payload.t)) };
    batch.push({ ...it, t: p.t, payload: p });
  }
  const body: any = { events: batch };
  if (!kickoffSent && batch.some(b => b.type === 'event' && b.payload.kind === 'kickoff')) {
    kickoffSent = true;
    body.meta = { home: 'Testland', away: 'Demoria', kickoff: remap(tape.kickoff), status: 'live' };
  }
  if (idx >= items.length) {
    clearInterval(iv);
    body.meta = {
      home: 'Testland', away: 'Demoria', kickoff: remap(tape.kickoff), status: 'finished',
      winner: tape.final.winner, regHome: tape.final.home, regAway: tape.final.away,
    };
    console.log('done — finished meta sent');
  }
  if (batch.length || body.meta) await post(body);
  if (batch.length) process.stdout.write(`\r${idx}/${items.length}`);
}, 1000);

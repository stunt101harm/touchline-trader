// Backfill missed live minutes into /api/ingest from the raw tape recorders.
// Run: npx tsx --env-file=.env.ingest scripts/backfill-live.ts <fixtureId> <sinceMs>
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { oddsToTick, parseScoreEvent } from '../web/shared/normalize';

const fixtureId = Number(process.argv[2]);
const since = Number(process.argv[3]);
const APP = process.env.APP_URL ?? 'https://touchline-trader.h-dhaliwal2250.workers.dev';
const KEY = process.env.INGEST_KEY!;
if (!fixtureId || !since || !KEY) { console.error('usage: backfill-live.ts <fixtureId> <sinceMs> (with INGEST_KEY)'); process.exit(1); }

type Ev = { t: number; type: 'tick' | 'event' | 'danger'; payload: unknown };
const out: Ev[] = [];

async function scan(file: string, kind: 'odds' | 'scores') {
  const rl = createInterface({ input: createReadStream(fileURLToPath(new URL(`../tapes/${file}`, import.meta.url))) });
  for await (const line of rl) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const recvMs = Number(line.slice(0, tab));
    if (recvMs < since) continue;
    const raw = line.slice(tab + 1);
    if (!raw.startsWith('data: {')) continue;
    let obj: any;
    try { obj = JSON.parse(raw.slice(6)); } catch { continue; }
    if (obj.FixtureId !== fixtureId) continue;
    if (kind === 'odds') {
      const tick = oddsToTick(obj, fixtureId);
      if (tick) out.push({ t: tick.t, type: 'tick', payload: tick });
    } else {
      const p = parseScoreEvent(obj, fixtureId);
      if (p?.danger) out.push({ t: p.danger.t, type: 'danger', payload: p.danger });
      if (p?.event) out.push({ t: p.event.t, type: 'event', payload: p.event });
    }
  }
}

await scan('odds-2026-07-17.tape', 'odds');
await scan('scores-2026-07-17.tape', 'scores');
out.sort((a, b) => a.t - b.t);
console.log(`backfilling ${out.length} events since ${new Date(since).toISOString()}`);

for (let i = 0; i < out.length; i += 500) {
  const batch = out.slice(i, i + 500);
  const r = await fetch(`${APP}/api/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-key': KEY },
    body: JSON.stringify({ fixtureId, events: batch, ...(i === 0 ? { meta: { home: 'France', away: 'England', kickoff: 1784408400000, status: 'live' } } : {}) }),
  });
  if (!r.ok) { console.error('batch failed', r.status, await r.text()); process.exit(1); }
  process.stdout.write(`\r${Math.min(i + 500, out.length)}/${out.length}`);
}
console.log('\nbackfill complete');

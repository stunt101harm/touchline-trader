// Live ingest: TxLINE SSE -> normalized events -> Worker /api/ingest (D1).
// Runs locally on match day. Run:
//   npx tsx --env-file=.env --env-file=.env.txline --env-file=.env.ingest scripts/live-ingest.ts <fixtureId> <home> <away> <kickoffMs>
// e.g. France–England: 18257865 France England 1784408400000
import { oddsToTick, parseScoreEvent, regulationScore } from '../web/shared/normalize';

const [fixtureId, home, away, kickoff] = [Number(process.argv[2]), process.argv[3], process.argv[4], Number(process.argv[5])];
if (!fixtureId || !home || !away || !kickoff) {
  console.error('usage: live-ingest.ts <fixtureId> <home> <away> <kickoffMs>');
  process.exit(1);
}

const BASE = process.env.TXLINE_BASE ?? 'https://txline-dev.txodds.com/api';
const H = { authorization: `Bearer ${process.env.TXLINE_JWT}`, 'x-api-token': process.env.TXLINE_API_TOKEN! };
const APP = process.env.APP_URL ?? 'https://touchline-trader.h-dhaliwal2250.workers.dev';
const KEY = process.env.INGEST_KEY!;
if (!KEY) { console.error('INGEST_KEY missing'); process.exit(1); }

type Ev = { t: number; type: 'tick' | 'event' | 'danger'; payload: unknown };
let queue: Ev[] = [];
let meta: any = { home, away, kickoff, status: 'upcoming' };
let metaDirty = true;
const note = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

async function flush() {
  if (!queue.length && !metaDirty) return;
  const batch = queue; queue = [];
  const body: any = { fixtureId, events: batch };
  if (metaDirty) { body.meta = { ...meta }; metaDirty = false; }
  try {
    const r = await fetch(`${APP}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-key': KEY },
      body: JSON.stringify(body),
    });
    if (!r.ok) { note(`ingest ${r.status} — requeueing ${batch.length}`); queue = batch.concat(queue); metaDirty = true; }
    else if (batch.length) note(`pushed ${batch.length} events`);
  } catch (e: any) {
    note(`ingest error ${e.message} — requeueing`); queue = batch.concat(queue); metaDirty = true;
  }
}
setInterval(flush, 1500);

async function consume(stream: 'odds' | 'scores') {
  let attempt = 0;
  for (;;) {
    try {
      note(`[${stream}] connecting`);
      const res = await fetch(`${BASE}/${stream}/stream`, {
        headers: { ...H, accept: 'text/event-stream', 'accept-encoding': 'deflate' } as any,
      });
      if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
      note(`[${stream}] connected`);
      attempt = 0;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data: ')) continue;
          let obj: any;
          try { obj = JSON.parse(line.slice(6)); } catch { continue; }
          handle(stream, obj);
        }
      }
      note(`[${stream}] stream ended`);
    } catch (e: any) {
      note(`[${stream}] error: ${e.message}`);
    }
    attempt++;
    await new Promise(r => setTimeout(r, Math.min(30000, 1000 * 2 ** Math.min(attempt, 5))));
  }
}

function handle(stream: 'odds' | 'scores', obj: any) {
  if (obj.FixtureId !== fixtureId) return;
  if (stream === 'odds') {
    const tick = oddsToTick(obj, fixtureId);
    if (tick) queue.push({ t: tick.t, type: 'tick', payload: tick });
    return;
  }
  // scores stream
  if (obj.Action === 'kickoff' && meta.status === 'upcoming') { meta.status = 'live'; metaDirty = true; note('KICKOFF — status live'); }
  if (obj.Action === 'game_finalised') {
    const [rh, ra] = regulationScore(obj);
    meta.status = 'finished';
    meta.regHome = rh; meta.regAway = ra;
    meta.winner = rh > ra ? 'home' : ra > rh ? 'away' : 'draw';
    metaDirty = true;
    note(`FINALISED ${rh}-${ra} → ${meta.winner}`);
  }
  const p = parseScoreEvent(obj, fixtureId);
  if (!p) return;
  if (p.danger) queue.push({ t: p.danger.t, type: 'danger', payload: p.danger });
  if (p.event) queue.push({ t: p.event.t, type: 'event', payload: p.event });
}

note(`live ingest for ${fixtureId} ${home} v ${away}, kickoff ${new Date(kickoff).toISOString()}`);
consume('odds');
consume('scores');

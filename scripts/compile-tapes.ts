// Compile TxLINE historical data into replay TapeBundles for the Time Traveler.
// Sources: /scores/historical/{id} (SSE text) + /odds/updates/{epochDay}/{hour}/{interval} buckets.
// Output: web/public/tapes/{fixtureId}.json + web/public/tapes/index.json (static assets — judge-proof).
// Run: npx tsx --env-file=.env --env-file=.env.txline scripts/compile-tapes.ts [fixtureId…]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { oddsToTick, parseScoreEvent, regulationScore } from '../web/shared/normalize';
import type { DangerSpan, MatchEvent, Outcome, TapeBundle, TapeManifestEntry, Tick } from '../web/shared/types';

const BASE = process.env.TXLINE_BASE ?? 'https://txline-dev.txodds.com/api';
const H = { authorization: `Bearer ${process.env.TXLINE_JWT}`, 'x-api-token': process.env.TXLINE_API_TOKEN! };
const OUT = fileURLToPath(new URL('../web/public/tapes', import.meta.url));
mkdirSync(OUT, { recursive: true });

const LABELS: Record<number, { label: string; featured?: boolean }> = {
  18237038: { label: 'Semi-final' },            // France–Spain
  18241006: { label: 'Semi-final', featured: true }, // England–Argentina (two late goals)
  18222446: { label: 'Quarter-final' },         // Argentina–Switzerland
  18213979: { label: 'Quarter-final' },         // Norway–England
  18218149: { label: 'Quarter-final' },         // Spain–Belgium
  18209181: { label: 'Quarter-final' },         // France–Morocco
  18202783: { label: 'Round of 16' },
  18198205: { label: 'Round of 16' },           // Portugal–Spain
  18202701: { label: 'Round of 16' },
  18193785: { label: 'Round of 16' },           // USA–Belgium
  18192996: { label: 'Round of 16' },           // Mexico–England
  18187298: { label: 'Group stage' },
  18188721: { label: 'Group stage' },
  18185036: { label: 'Group stage' },
  18179549: { label: 'Group stage' },
  18175918: { label: 'Group stage' },           // Argentina–Cape Verde (went to ET)
};

const intervalCache = new Map<string, any[]>();
async function oddsInterval(tsMs: number): Promise<any[]> {
  const epochDay = Math.floor(tsMs / 86400000);
  const hour = Math.floor((tsMs % 86400000) / 3600000);
  const interval = Math.floor((tsMs % 3600000) / 300000);
  const key = `${epochDay}/${hour}/${interval}`;
  if (intervalCache.has(key)) return intervalCache.get(key)!;
  const res = await fetch(`${BASE}/odds/updates/${key}`, { headers: H });
  let arr: any[] = [];
  try { arr = JSON.parse(await res.text()); } catch { /* empty bucket */ }
  if (!Array.isArray(arr)) arr = [];
  intervalCache.set(key, arr);
  return arr;
}

async function compile(fx: any): Promise<TapeBundle | null> {
  const id: number = fx.FixtureId;
  const res = await fetch(`${BASE}/scores/historical/${id}`, { headers: H });
  const text = await res.text();
  const raw = text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => {
    try { return JSON.parse(l.slice(6)); } catch { return null; }
  }).filter(Boolean);
  if (raw.length < 100) return null;

  raw.sort((a, b) => (a.Ts - b.Ts) || ((a.Seq ?? 0) - (b.Seq ?? 0)));
  const events: MatchEvent[] = [];
  const danger: DangerSpan[] = [];
  let finalEv: any = null;
  let kickoffTs: number | null = null;
  for (const s of raw) {
    if (s.Action === 'game_finalised') finalEv = s;
    if (s.Action === 'kickoff' && kickoffTs === null) kickoffTs = s.Ts;
    const p = parseScoreEvent(s, id);
    if (!p) continue;
    if (p.event) events.push(p.event);
    if (p.danger) danger.push(p.danger);
  }
  if (!finalEv) return null;
  const [rh, ra] = regulationScore(finalEv);
  const winner: Outcome = rh > ra ? 'home' : ra > rh ? 'away' : 'draw';

  const start = (kickoffTs ?? fx.StartTime) - 40 * 60 * 1000;
  const end = finalEv.Ts + 10 * 60 * 1000;
  const ticks: Tick[] = [];
  for (let t = start; t <= end; t += 300000) {
    for (const o of await oddsInterval(t)) {
      const tick = oddsToTick(o, id);
      if (tick) ticks.push(tick);
    }
  }
  ticks.sort((a, b) => a.t - b.t);
  if (ticks.length < 20) return null;

  const tail = finalEv.Ts;
  events.push({ t: tail, kind: 'fulltime', team: 0, score: [rh, ra] });

  return {
    fixtureId: id,
    home: fx.Participant1,
    away: fx.Participant2,
    kickoff: kickoffTs ?? fx.StartTime,
    final: { home: rh, away: ra, winner },
    ticks,
    events,
    danger,
    meta: { source: 'historical', compiledAt: 0, label: LABELS[id]?.label },
  };
}

const fixtures: any[] = JSON.parse(readFileSync(fileURLToPath(new URL('../captures/fixtures-all.json', import.meta.url)), 'utf8'));
const only = process.argv.slice(2).map(Number).filter(Boolean);
const targets = fixtures.filter((f) => LABELS[f.FixtureId] && (!only.length || only.includes(f.FixtureId)));
// dedupe by FixtureId keeping latest Ts
const byId = new Map<number, any>();
for (const f of targets) if (!byId.has(f.FixtureId) || f.Ts > byId.get(f.FixtureId).Ts) byId.set(f.FixtureId, f);

const manifest: TapeManifestEntry[] = [];
for (const fx of byId.values()) {
  process.stdout.write(`${fx.FixtureId} ${fx.Participant1}-${fx.Participant2} … `);
  try {
    const bundle = await compile(fx);
    if (!bundle) { console.log('SKIP (insufficient data)'); continue; }
    writeFileSync(`${OUT}/${fx.FixtureId}.json`, JSON.stringify(bundle));
    manifest.push({
      fixtureId: bundle.fixtureId, home: bundle.home, away: bundle.away, kickoff: bundle.kickoff,
      label: bundle.meta.label ?? 'World Cup', final: bundle.final,
      tickCount: bundle.ticks.length, eventCount: bundle.events.length,
      featured: LABELS[fx.FixtureId]?.featured,
    });
    console.log(`ok  ticks=${bundle.ticks.length} events=${bundle.events.length} final=${bundle.final!.home}-${bundle.final!.away} (${bundle.final!.winner})`);
  } catch (e: any) {
    console.log('ERROR', e.message);
  }
}
manifest.sort((a, b) => b.kickoff - a.kickoff);
writeFileSync(`${OUT}/index.json`, JSON.stringify(manifest, null, 1));
console.log(`\nmanifest: ${manifest.length} tapes → web/public/tapes/`);

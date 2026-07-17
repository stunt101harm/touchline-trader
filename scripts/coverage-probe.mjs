// Day-0 evidence: enumerate World Cup fixtures and probe historical scores/odds coverage per fixture.
// Run: node --env-file=.env --env-file=.env.txline scripts/coverage-probe.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.TXLINE_BASE ?? 'https://txline-dev.txodds.com/api';
const H = { authorization: `Bearer ${process.env.TXLINE_JWT}`, 'x-api-token': process.env.TXLINE_API_TOKEN };
const out = (p) => fileURLToPath(new URL(`../captures/${p}`, import.meta.url));

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: H });
  const text = await res.text();
  return { status: res.status, body: text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
};

// 1. enumerate fixtures across the tournament (Jun 11 = epochDay 20615 … Jul 19 = 20653)
const seen = new Map();
for (let d = 20615; d <= 20653; d += 1) {
  const r = await get(`/fixtures/snapshot?competitionId=72&startEpochDay=${d}`);
  if (r.status !== 200 || !Array.isArray(r.json)) continue;
  for (const f of r.json) seen.set(f.FixtureId, f);
}
const fixtures = [...seen.values()].sort((a, b) => a.StartTime - b.StartTime);
console.log(`fixtures discovered: ${fixtures.length}`);
writeFileSync(out('fixtures-all.json'), JSON.stringify(fixtures, null, 1));

// 2. probe each completed fixture for historical scores + odds interval density
const now = Date.now();
const rows = [];
let savedScoreSample = false, savedOddsSample = false;
for (const f of fixtures) {
  if (f.StartTime > now) { rows.push({ id: f.FixtureId, match: `${f.Participant1}-${f.Participant2}`, upcoming: true }); continue; }
  const hist = await get(`/scores/historical/${f.FixtureId}`);
  const sseEvents = hist.body.split('\n').filter(l => l.startsWith('data: '));
  const scoreEvents = Array.isArray(hist.json) ? hist.json.length : sseEvents.length;
  if (!savedScoreSample && scoreEvents > 500) { writeFileSync(out(`scores-historical-${f.FixtureId}.sse`), hist.body); savedScoreSample = true; }

  // odds: probe a 5-min interval one hour into the match
  const t = f.StartTime + 60 * 60 * 1000;
  const epochDay = Math.floor(t / 86400000);
  const hour = Math.floor((t % 86400000) / 3600000);
  const interval = Math.floor((t % 3600000) / 300000);
  const oddsIv = await get(`/odds/updates/${epochDay}/${hour}/${interval}`);
  const allOdds = Array.isArray(oddsIv.json) ? oddsIv.json : [];
  const fixtureOdds = allOdds.filter(o => o.FixtureId === f.FixtureId);
  if (!savedOddsSample && fixtureOdds.length > 5) { writeFileSync(out(`odds-interval-${f.FixtureId}.json`), JSON.stringify(fixtureOdds, null, 1)); savedOddsSample = true; }

  rows.push({
    id: f.FixtureId, match: `${f.Participant1}-${f.Participant2}`,
    start: new Date(f.StartTime).toISOString().slice(0, 16),
    scoreEvents, scoresStatus: hist.status,
    oddsIn5min: fixtureOdds.length, oddsIntervalTotal: allOdds.length, oddsStatus: oddsIv.status,
  });
  process.stdout.write('.');
}
console.log('\n');
writeFileSync(out('coverage-table.json'), JSON.stringify(rows, null, 1));

const done = rows.filter(r => !r.upcoming);
const withScores = done.filter(r => r.scoreEvents > 0);
const withOdds = done.filter(r => r.oddsIn5min > 0);
console.log(`completed fixtures probed: ${done.length}`);
console.log(`  with historical scores:  ${withScores.length} (median events: ${withScores.map(r => r.scoreEvents).sort((a, b) => a - b)[Math.floor(withScores.length / 2)] ?? 0})`);
console.log(`  with odds in probed 5-min interval: ${withOdds.length} (median ticks/5min: ${withOdds.map(r => r.oddsIn5min).sort((a, b) => a - b)[Math.floor(withOdds.length / 2)] ?? 0})`);
console.log('\nworst 5 by scoreEvents:', done.sort((a, b) => a.scoreEvents - b.scoreEvents).slice(0, 5).map(r => `${r.match}:${r.scoreEvents}`).join(' '));
console.log('best 5 by odds density:', done.sort((a, b) => b.oddsIn5min - a.oddsIn5min).slice(0, 5).map(r => `${r.match}:${r.oddsIn5min}`).join(' '));

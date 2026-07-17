# TxLINE Field Inventory & Day-0 Evidence (2026-07-17)

Everything below is verified against the live devnet API, not docs. Sample payloads in `captures/` (gitignored where large; summaries here are canonical).

## Auth & subscription (verified working)

- Flow: `POST /auth/guest/start` → on-chain `subscribe(serviceLevelId, weeks)` on program `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` (devnet) → sign `${txSig}::${jwt}` (nacl detached, base64) → `POST /api/token/activate` → opaque 45-char API token.
- Headers on every data request: `Authorization: Bearer <jwt>` + `X-Api-Token: <token>`.
- **Devnet pricing matrix has exactly one row: level 1, 0 TxL/week, samplingIntervalSec 0 → free tier IS real-time on devnet.** No 60s-delay risk.
- Guest JWT expires 2026-08-16 (30 days) — outlives judging. API token is opaque (no readable TTL); subscription duration 4 weeks.
- Our subscription tx: `4k8Cb85zWRpq1S44r9DkohYJ5EVLYdDFeRHf9V1DHmUK5XKh4JmK94RBJNyB5tR6zGFkbK5avZU68xoXEp1Fb5gs` ([Solscan](https://solscan.io/tx/4k8Cb85zWRpq1S44r9DkohYJ5EVLYdDFeRHf9V1DHmUK5XKh4JmK94RBJNyB5tR6zGFkbK5avZU68xoXEp1Fb5gs?cluster=devnet)) — the "data feed purchased on Solana" link for the provably-fair page.
- Gotcha: the paid path (`POST /api/guest/purchase/quote`) fails without devnet USDT (`Insufficient USDT balance... Found: 0`) and there is no documented faucet. The FREE tier (direct on-chain subscribe, zero TxL) is the correct hackathon path.
- Gotcha: the shipped IDL's `address` field is the mainnet program (`9Exb…`); must override to the devnet program id.

## Key fixtures

| Fixture | Match | Kickoff (UTC) |
|---|---|---|
| **18257865** | France–England (3rd place) | 2026-07-18 21:00 |
| **18257739** | Spain–Argentina (FINAL) | 2026-07-19 19:00 |

Final ends ~21:00–22:15 UTC with ET/pens vs 23:59 deadline → confirms: submit before kickoff.

## Odds stream (`GET /api/odds/stream`, SSE)

- Frame: `data: {json}` line, then `id: <ts:counter>` line (→ Last-Event-ID resume looks supported), heartbeat frames (`event: heartbeat` + `data: {"Ts":…}`) every ~15s when quiet.
- One synthetic bookmaker: **`TXLineStablePriceDemargined`** — consensus StablePrice, already de-margined.
- **`Pct` field carries implied probabilities directly** (strings, sum ≈ 100). No overround math needed. `Prices` are decimal odds ×1000.
- Market types seen: `1X2_PARTICIPANT_RESULT` (PriceNames `[part1, draw, part2]` — **our price tape**, `MarketPeriod: null` = full match), `ASIANHANDICAP_PARTICIPANT_GOALS`, `OVERUNDER_PARTICIPANT_GOALS` (with `MarketParameters` like `line=2.5`, `MarketPeriod` like `half=1`).
- `FixtureId` on every event → trivial per-fixture filtering. `InRunning` flags in-play.
- Pre-match 1X2 ticks for both remaining fixtures are flowing tonight (recorder capturing).

## Scores endpoints

- `GET /api/scores/historical/{fixtureId}` and `/scores/updates/{fixtureId}` return **SSE-formatted text** (`data:` lines), NOT a JSON array. `/scores/snapshot/{fixtureId}` returns a JSON array. Parse accordingly.
- Event shape: `{FixtureId, Action, Id, Seq, Ts, Clock:{Running,Seconds}, StatusId, Score, Stats, Participant, Possession, PossessionType, Data…}`. `Seq` orders events; `Clock.Seconds` is match time.
- Action vocabulary (from a full match tape): `goal`, `shot`, `corner`, `yellow_card`, `red_card`(unseen but in schema), `var`/`var_end`, `penalty`(via free_kick/Data), `substitution`, `kickoff`, `injury`, `additional_time`, `halftime_finalised`, `game_finalised`, `clock_adjustment`, possession actions: `attack_possession`, `safe_possession`, `danger_possession`, `high_danger_possession`, plus meta (`lineups`, `weather`, `status`, `action_amend`, `action_discarded`, `comment`).
- `action_amend` / `action_discarded` exist → the engine must handle corrections (match by amended `Id`).

## Historical odds (`GET /api/odds/updates/{epochDay}/{hourOfDay}/{interval}`)

- Returns **every update in the 5-min bucket** (JSON array, all fixtures mixed — filter by `FixtureId`). NOT one sample per 5 min.
- In-play density: median **241 ticks/5min per fixture** (all markets), up to 5,536 (USA–Belgium). 1X2-only: ~18/5min baseline with bursts at events. Replay charts will be alive; micro-interpolation is polish, not rescue.
- epochDay/hour/interval are UTC-derived: `epochDay = floor(tsMs/86400000)`, `hour = floor((tsMs%86400000)/3600000)`, `interval = floor((tsMs%3600000)/300000)`.

## Historical coverage (probed all 104 completed fixtures)

- Odds intervals: **101/104** fixtures have data.
- Full score histories: **16/104** fixtures (devnet carries a sample set), median 1,102 events each. Full table: `captures/coverage-table.json`.
- The 16 include both semifinals — **France–Spain (Jul 14)** and **England–Argentina (Jul 15, two late goals)** — plus QFs (Argentina–Switzerland, Norway–England), Spain–Belgium, France–Morocco, Portugal–Spain, Mexico–England, USA–Belgium, Paraguay–France, Brazil–Norway, Canada–Morocco, Colombia–Ghana, Switzerland–Colombia, Argentina–Cape Verde, Argentina–Egypt.
- **Decision: Time Traveler ships these 16 (curated), plus verbatim recordings of France–England and the final.** "104 matches" claim is scoped accordingly.

## Fixtures endpoint

- `GET /api/fixtures/snapshot?competitionId=72` returns only current/upcoming (2 fixtures). Add `startEpochDay=N` to page through history; iterating days 20615–20653 yields 106 entries (104 matches + 2 dupes from rescheduling — dedupe by FixtureId, keep latest Ts).
- Competition 72 = World Cup. `GameState: 1` = scheduled.

## Recorders

- Two dumb raw-tape recorders (odds + scores) running since 2026-07-17 ~19:52 UTC, appending `${recvMs}\t${rawLine}` per SSE line with reconnect/backoff and heartbeat logging. Tapes in `tapes/` (gitignored), logs alongside.

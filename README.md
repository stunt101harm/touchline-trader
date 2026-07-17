# ⚽📈 Touchline Trader

**Trade the match like a stock.**

A live win-probability trading game for the 2026 World Cup. Every match is a market: the price of "Argentina to win" ticks in real time off [TxLINE](https://txline.txodds.com) consensus odds. Buy because you believe, sell because you're scared, and feel every goal as a market crash. Settlement is provably fair — the final result and its TxLINE Merkle proof root are posted on Solana.

Built solo for the **TxLINE World Cup Hackathon** (TxODDS × Solana / Superteam Earn), July 2026.

## What it does

- 📈 **Live market per match** — TxLINE consensus StablePrice odds stream rendered as a live price chart; goals, cards, and VAR decisions land as annotations, so every price move has a visible on-pitch cause.
- 💰 **Trade with free coins** — buy/sell win-probability at the live consensus price; positions, P&L, and streak badges update tick by tick. No payouts, no gambling — a game with provably fair settlement.
- 🤖 **Live match rooms** — leaderboard vs. friends and seeded rival traders.
- ⛓️ **Provably fair settlement** — at full time the market resolves to 0/100 from the Merkle-proved final score; result + proof root are committed on Solana devnet (Solscan-verifiable).
- ⏪ **Time Traveler mode** — trade any completed World Cup match in replay at 1×–60× speed. An entire match's market drama in 25 seconds.

**▶ Live app: https://touchline-trader.h-dhaliwal2250.workers.dev** — no signup; you land inside a replaying match in seconds.

## Technical documentation

### Architecture

```
TxLINE devnet API ──▶ local ingest (scripts/live-ingest.ts) ──▶ Cloudflare Worker /api/ingest
  odds/scores SSE          normalize to internal schema              │ (keyed)
  historical endpoints                                               ▼
                                                          D1 (live_events, live_matches, scores)
  compile-tapes.ts ──▶ web/public/tapes/*.json  ──┐                  │ poll /api/live/:id/events (2s)
  attest.mjs ──▶ devnet memo txs                  ├──▶  Vite React SPA (Worker static assets)
               └─▶ web/public/attestations/*.json ┘        chart · trading engine · bots · replay
```

- **Judged path is static by construction**: the root route auto-plays a bundled replay tape with full trading — zero dependency on the ingest process, the TxLINE API, or any live service being awake.
- **One engine, two tape sources**: live mode and Time Traveler replay drive the identical event schema and trading engine; replay fills execute at each session's own clock position, so every judge trades coherently at any speed.
- **Provably fair**: the TxLINE data subscription was purchased on Solana devnet ([tx](https://solscan.io/tx/4k8Cb85zWRpq1S44r9DkohYJ5EVLYdDFeRHf9V1DHmUK5XKh4JmK94RBJNyB5tR6zGFkbK5avZU68xoXEp1Fb5gs?cluster=devnet)), and every settled market posts a devnet memo transaction anchoring TxLINE's Merkle `eventStatRoot` + the proven final score — see the ⛓ provably-fair page in the app.
- **Market semantics**: three-leg 1X2 (home/draw/away), long-only, sell = close; prices are TxLINE's demargined consensus implied probabilities (`Pct`); settlement pays 100/share on the regulation-time result (a 90' draw settles "draw" even if the tie is decided in extra time).

### TxLINE endpoints used

| Purpose | Endpoint |
|---|---|
| Auth | `POST /auth/guest/start` → on-chain `subscribe` (program `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`) → `POST /api/token/activate` |
| Live price tape | `GET /api/odds/stream` (SSE, `TXLineStablePriceDemargined`, `1X2_PARTICIPANT_RESULT`) |
| Live match events | `GET /api/scores/stream` (SSE: goals, cards, VAR, danger states, clock) |
| Replay tapes | `GET /api/scores/historical/{fixtureId}` + `GET /api/odds/updates/{epochDay}/{hourOfDay}/{interval}` |
| Fixtures | `GET /api/fixtures/snapshot?competitionId=72&startEpochDay=N` |
| Settlement proofs | `GET /api/scores/stat-validation?fixtureId=&seq=&statKeys=1,2` (Merkle) |

Full field-level findings: [docs/field-inventory.md](docs/field-inventory.md) · API feedback: [FEEDBACK.md](FEEDBACK.md)

### Repo layout

`web/` Vite React SPA + Cloudflare Worker (Hono) + D1 schema · `web/shared/` types, normalizer, trading engine (pure) · `scripts/` onboarding, recorders, tape compiler, attestations, live ingest · `docs/` evidence + plans

### Run it

```bash
cd web && npm install
npm run dev            # SPA + Worker + local D1 (replay works with zero config)
npm run deploy         # build + wrangler deploy
```

Live mode additionally needs TxLINE devnet credentials (`scripts/subscribe.mjs`) and the ingest key — see [PLAN.md](PLAN.md).

## Business model

Free-to-play coins → Pro season pass (fast replays, danger overlay) + coin packs + entry-fee rooms with coin rake → white-label engagement layer for sportsbooks and broadcasters (play-money trading is a proven bettor-acquisition funnel, and TxODDS's normalized schema makes every competition a new market — this is a year-round product, not a five-week one).

## Stack

Cloudflare Workers + D1 + static assets · Vite + React · lightweight-charts · Solana devnet (web3.js, memo attestations) · TxLINE API (SSE streams, historical replay, Merkle validation)

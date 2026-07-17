# Touchline Trader — Implementation Plan

**Trade the match like a stock.** A live win-probability trading game for the 2026 World Cup, priced tick-by-tick by TxLINE consensus odds, with provably-fair settlement anchored on Solana.

- **Hackathon:** TxLINE World Cup Track (TxODDS × Solana / Superteam Earn)
- **Deadline:** July 19, 2026, 23:59 UTC — **submission filed BEFORE the final kicks off**
- **Live windows:** France–England (3rd place) Jul 18 ~21:00 UTC · Spain–Argentina (final) Jul 19
- **Repo:** https://github.com/stunt101harm/touchline-trader

> This plan was adversarially reviewed (engineer / hackathon-judge / API-integration critics) before work started; their blockers are folded in. The two governing insights: **(1) judges experience this product after the tournament, in a dead-feed world — the judged product is the replay experience, and it must not depend on any live infrastructure being awake; (2) the deadline collides with the final — the video and submission must be complete before kickoff, with final footage as an optional splice.**

## 1. Concept

You open the app and you're inside a match market: a live price chart of "Argentina to win," ticking off the TxLINE consensus StablePrice odds stream, with 1,000 free coins to trade. Buy at 58¢ because you believe. A goal against you is a market crash you feel — the candle craters and your position card flashes red. Goals, cards, and VAR land as annotations, so every price move has a visible on-pitch cause: you're trading the emotional arc of the match, not reading a scores feed.

A match-room leaderboard ranks you against seeded rival traders. At full time the market settles from the final score, provably: the result and its TxLINE Merkle proof root are posted to Solana devnet (Solscan-verifiable). **Time Traveler mode** replays completed matches at 1×–60× with full trading — an entire match's market drama in 25 seconds — and it's the landing experience, not a hidden mode.

**Framing rule (everywhere — UI, repo, video):** free-to-play prediction *game* with provably fair settlement. Coins only, no payouts, no betting vocabulary. Persistent "free to play · no real money" footer.

## 2. Judging-criteria mapping

| Criterion | How we win it |
|---|---|
| Fan Accessibility & UX | "Trade the match like a stock" needs zero explanation. Judge lands cold on a phone and is inside a ticking replay with BUY/SELL thumbs in ~3 seconds — no signup, no modal. |
| Real-Time Responsiveness | The product IS the feed: candles tick with consensus odds; goals detonate the chart in sync with broadcast (verified live during Jul 18 rehearsal). |
| Originality & Value | Consensus odds as a tradeable price tape — the sponsor's core asset as the product, plus danger-state-driven market drama. |
| Commercial Path | Visible in-app monetization surface (entry-fee rooms with coin rake, Pro tier gating 60× replay + danger-state overlay, coin packs) + white-label story for sportsbooks (TxODDS's existing customers) + normalized schema ⇒ every EPL matchday is a new market. |
| Completeness | Small protected surface — one chart, one trade flow, one leaderboard, one replay scrubber — finished, deployed, resilient to dead feeds. |

## 3. Architecture

```
TxLINE API (devnet)                            Solana devnet
  /api/odds/stream (SSE)  ──┬──▶ raw tape ──┐     ▲ settlement memo tx
  /api/scores/stream (SSE) ─┘   (2 recorders)│     │ (result + Merkle root)
  historical + snapshot endpoints            ▼     │
                                      ┌─────────────┐
                                      │ Ingest      │ normalize · persist · broadcast
                                      │ worker      │ bots (live) · settle
                                      │ (Railway)   │
                                      └──────┬──────┘
                                             ▼
                                      ┌─────────────┐  Realtime (≤4 msg/s/room)  ┌─────────────┐
                                      │  Supabase   │───────────────────────────▶│ Next.js app │
                                      │  Postgres   │◀── fills via API routes ───│  (Vercel)   │
                                      └─────────────┘                            └─────────────┘
                                                     Judged path: replay tapes served from own
                                                     DB + static JSON — NO worker/TxLINE dependency
```

**Components & key decisions**

1. **Dual raw recorders (start Day 0, tonight).** A dumb local Node script appending raw SSE bytes to per-stream files (no parsing — a schema bug must never corrupt the tape) AND the worker's recorder. Normalization reads *from* tape, so bugs are replayable, not fatal.
2. **Ingest worker** (long-lived Node on Railway — Vercel serverless can't hold SSE). Subscribes to both SSE streams, normalizes onto one internal event schema (`tick`, `goal`, `card`, `var`, `danger_state`, `clock`, `status`, `suspension`) **designed from real captured payloads, not guesses**. Reconnect with backoff + gap recovery: on reconnect, diff `/api/scores/updates/{fixtureId}` + `/api/odds/snapshot/{fixtureId}` against last-seen state and inject `recovered`-tagged catch-up events into broadcast and tape.
3. **One shared price transform.** Verify odds format Day 0; normalize overround: `p_i = (1/odds_i) / Σ(1/odds_j)`. Single function used by live and replay paths, unit-tested against a captured payload.
4. **Trading engine — long-only, close-only.** One market per match, one long-only instrument per outcome (prices sum to ~100 after normalization; three legs if 1X2, two if a to-qualify market verifiably exists). "Sell" only closes an existing position. Settlement: winning leg 100/share, others 0. No shorting, no margin. Trading locks during odds suspension (VAR/goal review) — freeze last price.
   - **Live fills:** server-authoritative Postgres function at latest global price, via Next.js API routes with service-role key (no RLS — demo game, all writes through our API keyed by local client id).
   - **Replay fills:** per-session, at the price at the session's replay-clock position, simulated client-side (positions/P&L/settlement per session, instant 0/100 settle at tape end). Built Day 1 — this is the judged trade loop.
5. **Chart** — `lightweight-charts`; series ref outside React state; ticks buffered and flushed via `requestAnimationFrame` (≤1 visual update/frame); at ≥8× replay speed, downsample (last-per-second + all annotated points). Explicit 60×-soak test on real tape.
6. **Replay engine** — recordings (verbatim, for Jul 18/19 matches) or historical endpoints + **score-event-anchored micro-tick interpolation (CORE scope — historical odds are likely 5-min sampled and a flat chart kills the judged demo)**. Replay claim scoped to verified coverage: if the Day 0 probe shows partial devnet history, ship "8 curated classics," not "104."
7. **Judge cold-start (the real product).** Root route auto-starts a featured replay (France–England or the final) at ~10×, coins pre-granted, auto-generated nickname, goal-crash reachable in <60s, leaderboard pre-populated (deterministic replay bots precomputed from tape + seeded demo rows). Served entirely from our DB/static JSON — worker dead, TxLINE token expired, app still works. Static JSON tapes for the two featured matches bundled with the app as last-resort fallback. Explicit states: "no live match — watch a replay," SSE-disconnected banner.
8. **Bots** — live: 5 personality traders in the worker (momentum, contrarian, danger-state sniper, diamond-hands, panic-seller). Replay: precomputed deterministic trades from the tape.
9. **Settlement** — decoupled: settle positions immediately from the scores stream's FT status and post the devnet **memo tx** (fixtureId + result) right away; attach the Merkle proof root (`/api/scores/stat-validation`) in a follow-up tx / audit panel when it lands (proof latency unknown — measured Jul 18). Anchor program = stretch. **"Provably fair" page** with clickable Solscan links: the app's own TxLINE subscription purchase tx + every settled match's attestation.
10. **Monetization surface (scored criterion — must be visible in-app):** mock entry-fee match rooms (5% coin rake), "Pro" tier gating 60× replay + danger-state overlay, coin top-up packs. Mock checkout is fine; on-screen is mandatory.
11. **Judging-week uptime:** judged path has zero live dependencies; pay hosting tiers if needed; keep-warm cron ping; verify Supabase doesn't pause.

## 4. Milestones & timeline

### Day 0 — Thu Jul 17 (tonight): EVIDENCE + TAPE. No scaffolding.
Strict order; scaffolding is pushed to Day 1 morning.
- **M0.1 Onboarding + auth lifecycle:** guest JWT → devnet purchase quote → wallet sign → token activate. **Screen-record the whole flow** (video's Solana segment). Decode token TTL (script re-auth as a one-shot if <72h); confirm service level is 12 (real-time) not 1 (60s delay) — ask in Discord if not in the response. Worker alerts loudly on 401/403.
- **M0.2 SSE evidence capture:** attach to both streams 15+ min, raw to disk. Write the field inventory: event framing, fixture-id field, market/outcome ids, StablePrice field, timestamps, suspension representation. Internal schema is designed from this. *Fallback if streams aren't per-fixture-filterable or lack StablePrice: poll `/api/odds/updates/{fixtureId}` at 2–5s as live tick source; SSE stays recorder-only.*
- **M0.3 Start both recorders** against live streams tonight (pre-match odds tick before kickoff — free soak test). They run continuously through Jul 19.
- **M0.4 Historical coverage probe:** script over all 104 fixtures → coverage table (has_scores, has_odds, tick_count). Pull one completed match's 5-min odds intervals — density verdict drives replay scope + confirms interpolation as core.
- **M0.5 Market semantics:** snapshot a knockout fixture that went to extra time — which markets exist, behavior after minute 90, draw handling. Commit product rules (1X2 three-leg vs to-qualify two-leg) in writing. Check StablePrice outcomes sum (~1.0 ⇒ margin-free; else normalize).
- **M0.6 `epochDay`/`hourOfDay` UTC helper + unit test** against a known payload (classic hour-burning off-by-one).
- **M0.7 Submission audit (15 min):** read full rules — repo/license, video hosting rules, form fields, eligibility, prohibited content. Checklist into `SUBMISSION.md`. **Start `FEEDBACK.md` now**; append every API surprise as it happens.

### Day 1 — Fri Jul 18: BUILD. Video script by afternoon.
- M1.1 (am) Scaffold + deploys: Next.js/Vercel, Supabase schema, worker on Railway, Realtime throttle (~4 msg/s/room, fills/goals immediate).
- M1.2 Ingest worker complete: tape → normalize → persist → broadcast; gap recovery; kill-connection test.
- M1.3 Chart UI on live/recorded ticks: annotations, goal-crash animation, rAF buffering, 60× soak test.
- M1.4 Trading engine: shared transform, long-only fills (live path), coin ledger, P&L.
- M1.5 Replay engine: session-clock fills, interpolation, speed control, match picker (scoped to verified coverage).
- M1.6 Root-route auto-demo v1 (judge cold-start path working end-to-end).
- M1.7 (pm) **Video script + shot list written** — Jul 18 capture is planned, not improvised. One segment per criterion + "how TxLINE powers the backend" (raw SSE payload → normalized event → chart tick, endpoints named on screen) + Solana subscription + monetization + feedback mention.
- **M1.8 21:00 UTC France–England (recorders already running):** rehearse live end-to-end; film money-shot candidates (split-screen TV + app); timestamp goal latency broadcast vs stream (if delayed: drive crash animation from scores stream, film money shot from replay of tonight's tape at 1× — indistinguishable on video; lock trading ±N s around goals); measure stat-validation proof latency after FT; one deliberate kill-connection recovery test mid-match.

### Day 2 — Sat Jul 19: SHIP BEFORE KICKOFF.
- M2.1 (early) Replay bots + seeded leaderboard; settlement flow (immediate settle + memo tx + Solscan link; proof attach async); provably-fair page.
- M2.2 Monetization surface; mobile polish; **copy audit** (grep for betting vocabulary → predict/trade/free coins; footer disclaimer).
- M2.3 **Kill-the-worker test:** worker stopped, incognito phone window, full 90-second cold path works from the deployed link.
- M2.4 (midday) **Edit video from Jul 18 footage + replay captures. Locked and uploaded by ~17:00 UTC.** Finalize `SUBMISSION.md`, `FEEDBACK.md`, README technical docs.
- **M2.5 File the submission BEFORE the final kicks off.** Final-match footage: optional single-segment splice only if the platform allows resubmission; never re-edit on deadline night. Recorders keep running through the final regardless (the final's tape becomes the featured replay post-submission if resubmission is allowed).

## 5. Cut order (if behind)

**Protected:** root-route replay demo with working trades · live chart + goal-crash · deployed link resilient to dead feeds · video locked by 17:00 UTC Jul 19 · submission filed before kickoff.
**Cut in order:** (1) Anchor program (→ memo tx), (2) live bots (→ precomputed/replay bots only), (3) streak badges, (4) wallet-connect UX, (5) match-picker breadth (→ 8 curated), (6) live-match room polish (judges never see it live; the video proves it).

## 6. Risk register

| Risk | Mitigation |
|---|---|
| Historical odds 5-min sampled → dead replay chart | M0.4 density check; score-event-anchored micro-tick interpolation as **core**; verbatim tape for Jul 18/19; scope replay claim to verified coverage. |
| SSE not per-fixture / no StablePrice field | M0.2 field inventory before schema; per-fixture polling fallback at 2–5s. |
| Recorder failure during France–England (only rehearsal + only backup footage) | Two independent recorders, started Day 0; raw bytes, parse-free; normalization replays from tape. |
| Deadline collision with the final (ET/pens → ~23:15 UTC) | Video locked 17:00 UTC from Jul 18 footage; submission filed pre-kickoff; final = optional splice. |
| Judge lands on dead app (worker asleep, token expired, Supabase paused) | Judged path = own DB + bundled static tapes, zero live dependencies; kill-the-worker test; keep-warm ping; paid tiers if needed. |
| Draw at 90' / market semantics wrong | M0.5 verification; three-leg 1X2 default; suspension → freeze + lock trading. |
| Feed delay (service level 1) guts real-time criterion | M0.1 service-level check; goal-latency measurement Jul 18; replay-tape money shot fallback; trade lock around goals vs broadcast front-running. |
| Sparse live ticks → dead chart | Cadence measured M0.2; interpolated micro-ticks between genuine updates. |
| Betting optics | Coins only, no payouts; copy audit; "free to play · no real money" footer; video leads with fun. |
| Token expiry mid-final | TTL decoded Day 0; scripted 60-second re-auth; loud 401 alerts. |

## 7. Deliverables checklist

- [ ] Deployed app (Vercel) — public link, judge-proof cold start
- [ ] Public repo: README, technical docs (endpoints, architecture), this PLAN
- [ ] Demo video ≤5 min — locked by Jul 19 ~17:00 UTC, one segment per criterion + TxLINE-backend segment
- [ ] `FEEDBACK.md` — TxLINE experience (likes + friction), built up from Day 0
- [ ] `SUBMISSION.md` — requirements checklist, filed on Superteam Earn **before the final kicks off**

## 8. TxLINE endpoints used

`POST /auth/guest/start` · `POST /api/guest/purchase/quote` · `POST /api/token/activate` · `GET /api/fixtures/snapshot` · `GET /api/odds/stream` (SSE) · `GET /api/odds/snapshot/{fixtureId}` · `GET /api/odds/updates/{fixtureId}` · `GET /api/odds/updates/{epochDay}/{hourOfDay}/{interval}` · `GET /api/scores/stream` (SSE) · `GET /api/scores/updates/{fixtureId}` · `GET /api/scores/historical/{fixtureId}` · `GET /api/scores/stat-validation`

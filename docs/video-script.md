# Demo Video Script & Shot List (≤5:00)

**Rule: the video is edited and uploaded from Jul 18 footage + replay captures, locked by Jul 19 ~17:00 UTC, submitted before the final kicks off.** A final-match clip may replace ONE segment only if Superteam Earn allows editing after submission.

One segment per judging criterion, in order:

| # | Time | Segment (criterion) | Shot |
|---|------|--------------------|------|
| 1 | 0:00–0:40 | **Hook + Fan UX** | Cold open, phone in hand: "You can watch the final. Or you can trade it." Cut to app cold-load → inside the England–Argentina replay in 3 seconds. Buy Argentina at 31¢ with one thumb. No signup shown — stress that. |
| 2 | 0:40–1:30 | **Real-Time Responsiveness** | THE MONEY SHOT (from Jul 18 France–England live): split-screen TV broadcast + phone. A real goal lands → candle craters/spikes in sync, position card flashes, toast fires. Danger-state pulse ("the app breathes with the match"). |
| 3 | 1:30–2:20 | **Originality + Time Traveler** | "Every match is a market. Even finished ones." Open picker → replay a classic at 30×–60×: an entire match's market drama in 25 seconds. Show the 0-0 draw grind (draw price climbing) vs the late-goal explosion. Bots leaderboard: "you're never trading alone." |
| 4 | 2:20–3:10 | **How TxLINE powers it** | Screen capture: raw SSE `data:` line (Pct field highlighted) → normalized tick → chart candle, endpoint names on screen (`/odds/stream`, `/scores/stream`, `/scores/historical`, `/odds/updates/{epochDay}/…`, `/scores/stat-validation`). One sentence: "TxLINE's demargined consensus odds ARE the price feed — we didn't build a market, we productized theirs." |
| 5 | 3:10–3:50 | **Solana / provably fair** | Subscription tx on Solscan ("this app's data feed was bought on Solana"). Full-time settlement → "Provably settled" link → the attestation tx with the Merkle stat root. Provably-fair page scroll: 16 attested matches. |
| 6 | 3:50–4:30 | **Monetization + scale** | Pro modal (coin packs, season pass, rooms with rake). One line on white-label: "play-money trading is the proven acquisition funnel sportsbooks pay for — and TxLINE's normalized schema means every EPL Tuesday is a new market." |
| 7 | 4:30–5:00 | **Completeness + close** | Rapid montage: cold start on a phone, replay, live, settle, Solscan. "Built solo in 48 hours on TxLINE + Solana + Cloudflare. Touchline Trader — trade the match." Link on screen. |

## Capture checklist (Jul 18, before 21:00 UTC kickoff)

- [ ] OBS scenes ready: (a) phone-frame app capture, (b) full-screen app, (c) split-screen layout for TV+phone
- [ ] Phone rig for TV+phone money shot (harm films; multiple takes per goal)
- [ ] Insurance captures recorded BEFORE the match (all replay segments 1, 3, 4, 5, 6 can be filmed any time — DO THEM IN THE AFTERNOON)
- [ ] During match: screen-record the app the ENTIRE match (money-shot source), phone-film the TV at every goal
- [ ] Timestamp goal latency (broadcast vs app) — if feed lags TV, film the money shot from tonight's recorded tape replayed at 1× (indistinguishable on video)
- [ ] After FT: run attest + compile scripts (runbook below), capture the fresh attestation on Solscan

## Match-day runbook (Jul 18)

1. ~18:00 UTC: verify recorders (`tail tapes/*-2026-07-18.log`), start live ingest:
   `npx tsx --env-file=.env --env-file=.env.txline --env-file=.env.ingest scripts/live-ingest.ts 18257865 France England 1784408400000`
2. Verify app picker shows "● LIVE" once kickoff status flips; trade the match for real (rehearsal).
3. Kill-connection test once mid-match (ctrl-C ingest 30s, restart — verify recovery).
4. At FT: measure stat-validation latency, then:
   - `node --env-file=.env --env-file=.env.txline scripts/attest.mjs 18257865` (needs tape entry: add LABELS['18257865'] to compile-tapes first)
   - Add `18257865: { label: '3rd place', featured: true }` to compile-tapes LABELS, run compile, redeploy → France–England becomes the featured replay with verbatim-density ticks.
5. Evening: assemble the edit (CapCut/iMovie/DaVinci), upload unlisted YouTube.

## Jul 19 runbook

1. Morning: final polish pass; kill-the-worker phone test; README/docs final; FEEDBACK.md final.
2. ~15:00 UTC: video locked + uploaded. SUBMISSION.md checklist all green.
3. **Before 19:00 UTC: file the Superteam Earn submission.** Check resubmission policy when filing.
4. 19:00 UTC: start live ingest for the final (`18257739 Spain Argentina 1784487600000`), trade it live, enjoy.
5. Post-FT: attest + compile the final; if resubmission allowed, splice segment 2 with final footage and update.
